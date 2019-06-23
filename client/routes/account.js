var express = require('express');
var router = express.Router();
var accountTask = require('../controller/account')

/* show my accounts */
router.get('/', accountTask.showMyAccounts);

module.exports = router;
