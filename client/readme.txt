geth --datadir . --networkid 3333 --rpc --rpcport 8555 --ws --wsaddr 0.0.0.0 --wsport 8881 --wsorigins="*" --port 30303 --rpccorsdomain "*" --rpcapi "db,eth,net,web3,personal,admin,miner,debug,txpool" --wsapi "db,eth,net,web3,personal,admin,miner,debug,txpool" --nodiscover console

* clients
npm start 3001 50001
npm start 3002 50002
npm start 3003 50003

* server
npm start 3004 50004

* necessary
npm install solc@0.4.24 --save