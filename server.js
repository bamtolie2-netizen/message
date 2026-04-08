/**
 * 슈어엠(SureM) API 프록시 서버 — Node.js (Express)
 * -------------------------------------------------------
 * CORS 문제를 해결하기 위한 백엔드 프록시 서버입니다.
 * 브라우저(프론트엔드) ──► 이 서버 ──► rest.surem.com
 *
 * 설치: npm install
 * 실행: node server.js
 * 환경: Node.js 18+
 */

const express = require('express');
const cors    = require('cors');
const axios   = require('axios');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── 슈어엠 API 기본 URL ──────────────────────────────────
const SUREM_BASE = 'https://rest.surem.com';

// ── 미들웨어 ─────────────────────────────────────────────
app.use(express.json());

// CORS 허용 출처 설정 (실제 운영 시 도메인을 정확히 지정하세요)
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*', // 예: 'https://your-frontend.com'
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── 공통 헬퍼: 슈어엠으로 요청 전달 ─────────────────────
async function proxyRequest(method, path, { body, headers, params } = {}) {
  const config = {
    method,
    url: `${SUREM_BASE}${path}`,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body)   config.data   = body;
  if (params) config.params = params;

  const response = await axios(config);
  return response.data;
}

// ── 에러 핸들러 래퍼 ─────────────────────────────────────
function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ════════════════════════════════════════════════════════
// 1. 인증 — 토큰 발급
//    POST /proxy/auth/token
//    Body: { userCode, secretKey }
// ════════════════════════════════════════════════════════
app.post('/proxy/auth/token', asyncHandler(async (req, res) => {
  const { userCode, secretKey } = req.body;

  if (!userCode || !secretKey) {
    return res.status(400).json({ code: 'ERR_PARAM', message: 'userCode와 secretKey가 필요합니다.' });
  }

  const data = await proxyRequest('POST', '/api/v1/auth/token', {
    body: { userCode, secretKey },
  });

  res.json(data);
}));

// ════════════════════════════════════════════════════════
// 2. SMS 발송
//    POST /proxy/send/sms
//    Headers: Authorization: Bearer {token}
//    Body: { to, text, reqPhone, reservedTime?, messageId? }
// ════════════════════════════════════════════════════════
app.post('/proxy/send/sms', asyncHandler(async (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ code: 'ERR_AUTH', message: '토큰이 없습니다.' });

  const { to, text, reqPhone, reservedTime, messageId } = req.body;
  if (!to || !text || !reqPhone) {
    return res.status(400).json({ code: 'ERR_PARAM', message: 'to, text, reqPhone은 필수값입니다.' });
  }

  // 90byte 초과 체크 (서버에서도 검증)
  const byteLen = Buffer.byteLength(text, 'utf8');
  if (byteLen > 90) {
    return res.status(400).json({
      code: 'ERR_LENGTH',
      message: `SMS는 최대 90byte입니다. 현재 ${byteLen}byte. LMS 엔드포인트를 사용하세요.`,
    });
  }

  const body = { to, text, reqPhone };
  if (reservedTime) body.reservedTime = reservedTime;
  if (messageId)    body.messageId    = messageId;

  const data = await proxyRequest('POST', '/api/v1/send/sms', {
    headers: { Authorization: token },
    body,
  });

  res.json(data);
}));

// ════════════════════════════════════════════════════════
// 3. LMS / MMS 발송
//    POST /proxy/send/mms
//    Headers: Authorization: Bearer {token}
//    Body: { to, text, reqPhone, subject?, imageKey?, reservedTime?, messageId? }
// ════════════════════════════════════════════════════════
app.post('/proxy/send/mms', asyncHandler(async (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ code: 'ERR_AUTH', message: '토큰이 없습니다.' });

  const { to, text, reqPhone, subject, imageKey, reservedTime, messageId } = req.body;
  if (!to || !text || !reqPhone) {
    return res.status(400).json({ code: 'ERR_PARAM', message: 'to, text, reqPhone은 필수값입니다.' });
  }

  const body = { to, text, reqPhone };
  if (subject)      body.subject      = subject;
  if (imageKey)     body.imageKey     = imageKey;
  if (reservedTime) body.reservedTime = reservedTime;
  if (messageId)    body.messageId    = messageId;

  const data = await proxyRequest('POST', '/api/v1/send/mms', {
    headers: { Authorization: token },
    body,
  });

  res.json(data);
}));

// ════════════════════════════════════════════════════════
// 4. 전송 결과 조회 (Polling)
//    GET /proxy/report/responseAll?type=S
//    Headers: Authorization: Bearer {token}
//    Query: type = S|M|T|I|R|V
// ════════════════════════════════════════════════════════
app.get('/proxy/report/responseAll', asyncHandler(async (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ code: 'ERR_AUTH', message: '토큰이 없습니다.' });

  const { type } = req.query;
  const validTypes = ['S', 'M', 'T', 'I', 'R', 'V'];
  if (!type || !validTypes.includes(type)) {
    return res.status(400).json({ code: 'ERR_PARAM', message: `type은 ${validTypes.join('|')} 중 하나여야 합니다.` });
  }

  const data = await proxyRequest('GET', '/api/v2/report/responseAll', {
    headers: { Authorization: token },
    params: { type },
  });

  res.json(data);
}));

// ════════════════════════════════════════════════════════
// 5. 결과 완료 처리
//    POST /proxy/report/complete
//    Headers: Authorization: Bearer {token}
//    Body: { checksum }
// ════════════════════════════════════════════════════════
app.post('/proxy/report/complete', asyncHandler(async (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ code: 'ERR_AUTH', message: '토큰이 없습니다.' });

  const { checksum } = req.body;
  if (!checksum) {
    return res.status(400).json({ code: 'ERR_PARAM', message: 'checksum이 필요합니다.' });
  }

  const data = await proxyRequest('POST', '/api/v2/report/complete', {
    headers: { Authorization: token },
    body: { checksum },
  });

  res.json(data);
}));

// ── 헬스체크 ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── 전역 에러 핸들러 ──────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[프록시 오류]', err.message);

  // Axios 응답 오류 (슈어엠이 4xx/5xx 반환한 경우)
  if (err.response) {
    return res.status(err.response.status).json(err.response.data);
  }

  res.status(500).json({ code: 'ERR_SERVER', message: err.message });
});

// ── 서버 시작 ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ 슈어엠 프록시 서버 실행 중: http://localhost:${PORT}`);
  console.log(`   헬스체크: http://localhost:${PORT}/health`);
});
