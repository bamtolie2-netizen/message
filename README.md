# 슈어엠 API 프록시 서버 설정 가이드

브라우저(프론트엔드)에서 슈어엠 API를 직접 호출하면 CORS 정책에 의해 차단됩니다.
이 프록시 서버는 그 중간에서 요청을 대신 전달해주는 역할을 합니다.

```
브라우저 ──► 프록시 서버(로컬/클라우드) ──► rest.surem.com
```

---

## Node.js 방식 (server.js)

### 설치 및 실행

```bash
# 1. 폴더 이동
cd surem-proxy-nodejs

# 2. 패키지 설치
npm install

# 3. 서버 실행
node server.js
# 또는 개발 시 자동 재시작
npx nodemon server.js
```

서버가 실행되면: `http://localhost:3000`

---

## Python 방식 (server.py)

### 설치 및 실행

```bash
# 1. 패키지 설치
pip install fastapi uvicorn httpx

# 2. 서버 실행
uvicorn server:app --reload --port 3000
```

서버가 실행되면:
- API: `http://localhost:3000`
- 자동 문서(Swagger): `http://localhost:3000/docs`

---

## 프론트엔드 연동 방법

프론트엔드 코드에서 슈어엠 주소 대신 프록시 주소로 변경합니다.

### 변경 전 (직접 호출 — CORS 오류 발생)
```javascript
fetch('https://rest.surem.com/api/v1/auth/token', { ... })
fetch('https://rest.surem.com/api/v1/send/sms', { ... })
```

### 변경 후 (프록시 경유 — 정상 동작)
```javascript
const PROXY = 'http://localhost:3000'; // 배포 시 실제 서버 주소로 변경

// 1. 토큰 발급
const res = await fetch(`${PROXY}/proxy/auth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userCode: '아이디', secretKey: 'API키' }),
});
const { data } = await res.json();
const token = data.accessToken;

// 2. SMS 발송
await fetch(`${PROXY}/proxy/send/sms`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ to: '01012345678', text: '안녕하세요', reqPhone: '15884640' }),
});

// 3. 결과 조회
const result = await fetch(`${PROXY}/proxy/report/responseAll?type=S`, {
  headers: { 'Authorization': `Bearer ${token}` },
});
const { data: list, checksum } = await result.json();

// 4. 완료 처리 (필수!)
await fetch(`${PROXY}/proxy/report/complete`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ checksum }),
});
```

---

## API 엔드포인트 목록

| 기능 | 메서드 | 프록시 경로 |
|------|--------|------------|
| 토큰 발급 | POST | `/proxy/auth/token` |
| SMS 발송 | POST | `/proxy/send/sms` |
| LMS/MMS 발송 | POST | `/proxy/send/mms` |
| 결과 조회 | GET | `/proxy/report/responseAll?type=S` |
| 완료 처리 | POST | `/proxy/report/complete` |
| 헬스체크 | GET | `/health` |

---

## 클라우드 배포 (운영 환경)

로컬에서 테스트 후 아래 서비스에 배포하면 실제 운영 가능합니다.

### Railway (Node.js 추천 — 무료 플랜 있음)
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### Render (Python 추천 — 무료 플랜 있음)
1. https://render.com 에서 New Web Service 생성
2. GitHub 저장소 연결
3. Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`

### 배포 후 CORS 설정 변경
운영 환경에서는 `*` 대신 프론트엔드 도메인만 허용하세요.

**Node.js:**
```javascript
// server.js 수정
origin: 'https://your-frontend.com'
```

**Python:**
```bash
# 환경변수로 설정
ALLOWED_ORIGINS=https://your-frontend.com uvicorn server:app ...
```

---

## 보안 주의사항

- `userCode`와 `secretKey`는 서버 환경변수로 관리하거나, 프론트에서 직접 입력받아 프록시로만 전달하세요.
- 프록시 서버의 CORS `origin`을 반드시 운영 도메인으로 제한하세요.
- HTTPS 환경에서 운영하세요 (토큰이 네트워크에 평문으로 노출되지 않도록).
