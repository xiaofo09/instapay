var fs = require('fs');
var Web3 = require('web3');
var solc = require('solc');
var grpc = require('grpc');
var protoLoader = require('@grpc/proto-loader');

/* web3 configuration*/
var web3 = new Web3(Web3.providers.WebsocketProvider('ws://localhost:8881'));


/* contract configuration */
var contractAddress = '0x57101f61852E1343A35b110b3946dd204719b9db' //'0xDcce465d1Ce7B8D775b2C7642b9EB6CaEfbD87c2';
var source = fs.readFileSync('../contracts/InstaPay.sol', 'utf8');
var compiledContract = solc.compile(source);

for (let contractName in compiledContract.contracts) {
    var bytecode = compiledContract.contracts[contractName].bytecode;
    var abi = JSON.parse(compiledContract.contracts[contractName].interface);
}

var contractInstance = new web3.eth.Contract(abi, contractAddress);
var event = contractInstance.events.allEvents();

/* grpc configuration (as client) */
var CLIENT_PROTO_PATH = __dirname + '/../protos/client.proto';
var packageDefinition = protoLoader.loadSync(
    CLIENT_PROTO_PATH,
    {keepCase: true,
     longs: String,
     enums: String,
     defaults: true,
     oneofs: true
    });
var clientProto = grpc.loadPackageDefinition(packageDefinition).InstaPayClient;
var myServer = new grpc.Server();


var SERVER_PROTO_PATH = __dirname + '/../protos/server.proto';
var packageDefinition = protoLoader.loadSync(
    SERVER_PROTO_PATH,
    {keepCase: true,
     longs: String,
     enums: String,
     defaults: true,
     oneofs: true
    });
var serverProto = grpc.loadPackageDefinition(packageDefinition).InstaPayServer;
var server = new serverProto.Server('localhost:50004',
                                   grpc.credentials.createInsecure());


module.exports = {
	web3:web3,
	contractInstance:contractInstance,
	contractAddress:contractAddress,
	event:event,
	clientProto:clientProto,
	myServer:myServer,
    server:server
}