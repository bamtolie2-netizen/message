const express = require('express');
const cors    = require('cors');
const axios   = require('axios');

const app  = express();
const PORT = process.env.PORT || 3000;

const SUREM_BASE = 'https://dynapi.surem.com';
const SECU_CD    = 'f71742597bd420117f7736f9b052a665fed39d1cdf53707f955da2d6921dcd32';

app.use(express.json());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

async function proxyRequest(method, path, options) {
  options = options || {};
  var body    = options.body    || null;
  var headers = options.headers || {};
  var params  = options.params  || {};

  params.secuCd = SECU_CD;

  var config = {
    method: method,
    url: SUREM_BASE + path,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    params: params,
  };
  if (body) config.data = body;

  var response = await axios(config);
  return response.data;
}

function asyncHandler(fn) {
  return function(req, res, next) {
    fn(req, res, next).catch(next);
  };
}

app.post('/proxy/auth/token', asyncHandler(async function(req, res) {
  var userCode  = req.body.userCode;
  var secretKey = req.body.secretKey;
  if (!userCode || !secretKey) {
    return res.status(400).json({ code: 'ERR_PARAM', message: 'userCode와 secretKey가 필요합니다.' });
  }
  var data = await proxyRequest('POST', '/api/v1/auth/token', {
    body: { userCode: userCode, secretKey: secretKey },
  });
  res.json(data);
}));

app.post('/proxy/send/sms', asyncHandler(async function(req, res) {
  var token = req.headers.authorization;
  if (!token) return res.status(401).json({ code: 'ERR_AUTH', message: '토큰이 없습니다.' });
  var body = {
    to:       req.body.to,
    text:     req.body.text,
    reqPhone: req.body.reqPhone,
  };
  if (req.body.reservedTime) body.reservedTime = req.body.reservedTime;
  if (req.body.messageId)    body.messageId    = req.body.messageId;
  var data = await proxyRequest('POST', '/api/v1/send/sms', {
    headers: { Authorization: token },
    body: body,
  });
  res.json(data);
}));

app.post('/proxy/send/mms', asyncHandler(async function(req, res) {
  var token = req.headers.authorization;
  if (!token) return res.status(401).json({ code: 'ERR_AUTH', message: '토큰이 없습니다.' });
  var body = {
    to:       req.body.to,
    text:     req.body.text,
    reqPhone: req.body.reqPhone,
  };
  if (req.body.subject)      body.subject      = req.body.subject;
  if (req.body.imageKey)     body.imageKey     = req.body.imageKey;
  if (req.body.reservedTime) body.reservedTime = req.body.reservedTime;
  if (req.body.messageId)    body.messageId    = req.body.messageId;
  var data = await proxyRequest('POST', '/api/v1/send/mms', {
    headers: { Authorization: token },
    body: body,
  });
  res.json(data);
}));

app.get('/proxy/report/responseAll', asyncHandler(async function(req, res) {
  var token = req.headers.authorization;
  if (!token) return res.status(401).json({ code: 'ERR_AUTH', message: '토큰이 없습니다.' });
  var type = req.query.type;
  var data = await proxyRequest('GET', '/api/v2/report/responseAll', {
    headers: { Authorization: token },
    params: { type: type },
  });
  res.json(data);
}));

app.post('/proxy/report/complete', asyncHandler(async function(req, res) {
  var token = req.headers.authorization;
  if (!token) return res.status(401).json({ code: 'ERR_AUTH', message: '토큰이 없습니다.' });
  var data = await proxyRequest('POST', '/api/v2/report/complete', {
    headers: { Authorization: token },
    body: { checksum: req.body.checksum },
  });
  res.json(data);
}));

app.get('/health', function(req, res) {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use(function(err, req, res, next) {
  console.error('[프록시 오류]', err.message);
  if (err.response) {
    return res.status(err.response.status).json(err.response.data);
  }
  res.status(500).json({ code: 'ERR_SERVER', message: err.message });
});

app.listen(PORT, function() {
  console.log('슈어엠 프록시 서버 실행 중: http://localhost:' + PORT);
  console.log('헬스체크: http://localhost:' + PORT + '/health');
});
