"""
슈어엠(SureM) API 프록시 서버 — Python (FastAPI)
--------------------------------------------------
CORS 문제를 해결하기 위한 백엔드 프록시 서버입니다.
브라우저(프론트엔드) ──► 이 서버 ──► rest.surem.com

설치: pip install fastapi uvicorn httpx python-dotenv
실행: uvicorn server:app --reload --port 3000
환경: Python 3.10+
"""

import os
from typing import Optional

import httpx
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── 슈어엠 API 기본 URL ──────────────────────────────────
SUREM_BASE = "https://rest.surem.com"

# ── FastAPI 앱 생성 ──────────────────────────────────────
app = FastAPI(
    title="슈어엠 API 프록시",
    description="브라우저 CORS 우회를 위한 슈어엠 REST API 프록시 서버",
    version="1.0.0",
)

# ── CORS 미들웨어 설정 ───────────────────────────────────
# 실제 운영 시 allow_origins를 프론트엔드 도메인으로 제한하세요
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── 공통 httpx 클라이언트 (재사용) ──────────────────────
http_client = httpx.AsyncClient(timeout=30.0)


# ════════════════════════════════════════════════════════
# 요청/응답 모델
# ════════════════════════════════════════════════════════

class TokenRequest(BaseModel):
    userCode: str
    secretKey: str

class SmsRequest(BaseModel):
    to: str
    text: str
    reqPhone: str
    reservedTime: Optional[str] = None
    messageId: Optional[int] = None

class MmsRequest(BaseModel):
    to: str
    text: str
    reqPhone: str
    subject: Optional[str] = None
    imageKey: Optional[str] = None
    reservedTime: Optional[str] = None
    messageId: Optional[int] = None

class CompleteRequest(BaseModel):
    checksum: str


# ── 공통 헬퍼: 슈어엠으로 요청 전달 ─────────────────────
async def proxy_post(path: str, body: dict, token: Optional[str] = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    try:
        resp = await http_client.post(f"{SUREM_BASE}{path}", json=body, headers=headers)
        return resp.json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"슈어엠 서버 연결 실패: {str(e)}")

async def proxy_get(path: str, token: str, params: dict) -> dict:
    headers = {"Authorization": token}
    try:
        resp = await http_client.get(f"{SUREM_BASE}{path}", params=params, headers=headers)
        return resp.json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"슈어엠 서버 연결 실패: {str(e)}")


# ════════════════════════════════════════════════════════
# 1. 인증 — 토큰 발급
#    POST /proxy/auth/token
# ════════════════════════════════════════════════════════
@app.post("/proxy/auth/token", summary="슈어엠 토큰 발급")
async def auth_token(req: TokenRequest):
    """
    슈어엠에서 발급받은 userCode와 secretKey로 Bearer 토큰을 발급합니다.
    발급된 토큰은 1시간 동안 유효하며, 만료 전 재사용을 권장합니다.
    """
    data = await proxy_post(
        "/api/v1/auth/token",
        {"userCode": req.userCode, "secretKey": req.secretKey},
    )
    return data


# ════════════════════════════════════════════════════════
# 2. SMS 발송
#    POST /proxy/send/sms
# ════════════════════════════════════════════════════════
@app.post("/proxy/send/sms", summary="SMS 발송")
async def send_sms(
    req: SmsRequest,
    authorization: str = Header(..., description="Bearer {access_token}"),
):
    """
    SMS를 발송합니다. 메시지는 최대 90byte이며 초과 시 잘려서 발송됩니다.
    90byte 초과 시 /proxy/send/mms 를 사용하세요 (LMS 자동 적용).
    """
    # 서버 측 byte 검증
    byte_len = len(req.text.encode("utf-8"))
    if byte_len > 90:
        raise HTTPException(
            status_code=400,
            detail=f"SMS는 최대 90byte입니다. 현재 {byte_len}byte. LMS 엔드포인트를 사용하세요.",
        )

    body = {"to": req.to, "text": req.text, "reqPhone": req.reqPhone}
    if req.reservedTime: body["reservedTime"] = req.reservedTime
    if req.messageId:    body["messageId"]    = req.messageId

    return await proxy_post("/api/v1/send/sms", body, authorization)


# ════════════════════════════════════════════════════════
# 3. LMS / MMS 발송
#    POST /proxy/send/mms
# ════════════════════════════════════════════════════════
@app.post("/proxy/send/mms", summary="LMS/MMS 발송")
async def send_mms(
    req: MmsRequest,
    authorization: str = Header(..., description="Bearer {access_token}"),
):
    """
    LMS 또는 MMS를 발송합니다.
    - imageKey 없음 → LMS (장문문자, 최대 2000byte)
    - imageKey 있음 → MMS (이미지 포함)
    """
    body = {"to": req.to, "text": req.text, "reqPhone": req.reqPhone}
    if req.subject:      body["subject"]      = req.subject
    if req.imageKey:     body["imageKey"]     = req.imageKey
    if req.reservedTime: body["reservedTime"] = req.reservedTime
    if req.messageId:    body["messageId"]    = req.messageId

    return await proxy_post("/api/v1/send/mms", body, authorization)


# ════════════════════════════════════════════════════════
# 4. 전송 결과 조회 (Polling)
#    GET /proxy/report/responseAll?type=S
# ════════════════════════════════════════════════════════
VALID_TYPES = {"S", "M", "T", "I", "R", "V"}

@app.get("/proxy/report/responseAll", summary="전송 결과 조회 (Polling)")
async def report_response_all(
    type: str = Query(..., description="S=SMS, M=MMS, T=카카오, I=국제, R=RCS, V=TTS"),
    authorization: str = Header(..., description="Bearer {access_token}"),
):
    """
    전송 결과를 조회합니다 (최대 300건).
    조회 후 반드시 /proxy/report/complete 로 완료 처리해야 합니다.
    미처리 시 동일한 결과가 재반환됩니다.
    """
    if type not in VALID_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"type은 {', '.join(sorted(VALID_TYPES))} 중 하나여야 합니다.",
        )
    return await proxy_get("/api/v2/report/responseAll", authorization, {"type": type})


# ════════════════════════════════════════════════════════
# 5. 결과 완료 처리
#    POST /proxy/report/complete
# ════════════════════════════════════════════════════════
@app.post("/proxy/report/complete", summary="결과 완료 처리")
async def report_complete(
    req: CompleteRequest,
    authorization: str = Header(..., description="Bearer {access_token}"),
):
    """
    결과 조회 후 반드시 호출해야 합니다.
    checksum 값은 /proxy/report/responseAll 응답의 checksum 필드입니다.
    """
    return await proxy_post("/api/v2/report/complete", {"checksum": req.checksum}, authorization)


# ── 헬스체크 ─────────────────────────────────────────────
@app.get("/health", summary="헬스체크")
async def health():
    from datetime import datetime
    return {"status": "ok", "time": datetime.now().isoformat()}


# ── 직접 실행 ─────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=3000, reload=True)
