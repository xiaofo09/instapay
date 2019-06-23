var express = require('express');
var router = express.Router();
var clientTask = require('../controller/client');

/* GET home page. */
router.get('/', clientTask.showClientInfo);
router.get('/channel', clientTask.showClientChannel);
router.get('/payment', clientTask.showPaymentHist);

module.exports = router;