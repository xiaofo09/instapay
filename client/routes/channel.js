var express = require('express');
var router = express.Router();
var channelTask = require('../controller/channel')

/* show my accounts */
router.get('/', channelTask.showMyChannels);
router.get('/request/openPage', channelTask.requestOpenPage);
router.post('/request/open', channelTask.requestOpen);
router.get('/request/pendingOpenPage', channelTask.requestPendingOpenPage);
router.post('/request/openConfirm', channelTask.requestOpenConfirm);
router.get('/request/payPage', channelTask.requestPayPage);
router.post('/request/pay', channelTask.requestPay);
router.post('/request/payAddr', channelTask.requestPayAddr);
router.post('/request/payInvoice', channelTask.requestPayInvoice);
router.post('/request/closeConfirm', channelTask.requestCloseConfirm);
router.post('/request/chalConfirm', channelTask.requestChalConfirm);
router.get('/request/pendingClosePage', channelTask.requestPendingClosePage);
router.get('/closedChannel', channelTask.requestClosedChannel);

module.exports = router;
