pragma solidity 0.4.24;

contract InstaPay {
    enum ChannelStatus {CLOSED, CLOSE_WAIT, OPEN, OPEN_WAIT}
    
    struct Party {
        address addr;
        uint dep;
    }
    
    struct Challenge {
        address addr;
        uint chall_bal;
        uint other_bal;
        uint vn;
    }
    
    struct Channel {
        Party alice;
        Party bob;
        uint opn_timeout;
        uint cls_timeout;
        ChannelStatus status;
        Challenge chall;
    }
    
    
    mapping (bytes32 => Channel) public channels;
    
    
    event EventOpenChannel(bytes32 id, address alice, address bob, uint alice_dep, uint opn_timeout, uint cls_delta);
    event EventOpenChannelRespond(bytes32 id, address alice, address bob, uint alice_dep, uint bob_dep);
    event EventOpenChannelTimeout(bytes32 id, address alice);
    event EventCloseChannel(bytes32 id, address challenger, uint bal1, uint bal2, uint vn, uint cls_timeout);
    event EventCloseChannelRespond(bytes32 id, address owner1, uint owner1_bal, address owner2, uint owner2_bal);
    event EventCloseChannelTimeout(bytes32 id, address owner1, uint owner1_bal, address owner2, uint owner2_bal);
    
    
    modifier onlyAliceOrBob(bytes32 id, address sender) {
        require(channels[id].alice.addr == sender || channels[id].bob.addr == sender);
        _;
    }
    
    
    function open_channel(bytes32 id, address bob, uint opn_delta, uint cls_delta) public payable {
        require(channels[id].status == ChannelStatus.CLOSED);
        
        channels[id].alice.addr = msg.sender;
        channels[id].alice.dep = msg.value;
        channels[id].bob.addr = bob;
        channels[id].opn_timeout = now + opn_delta * 1 seconds;
        channels[id].cls_timeout = cls_delta;
        
        channels[id].status = ChannelStatus.OPEN_WAIT;
        
        emit EventOpenChannel(id, msg.sender, bob, msg.value, channels[id].opn_timeout, cls_delta);
    }
    
    function open_channel_respond(bytes32 id) public payable {
        require(channels[id].bob.addr == msg.sender);
        require(channels[id].status == ChannelStatus.OPEN_WAIT);
        require(now > channels[id].opn_timeout);
        
        channels[id].bob.dep = msg.value;
        
        channels[id].status = ChannelStatus.OPEN;
        
        emit EventOpenChannelRespond(id, channels[id].alice.addr, msg.sender, channels[id].alice.dep, msg.value);
    }
    
    function open_channel_timeout(bytes32 id) public {
        require(channels[id].alice == msg.sender);
        require(channels[id].status == ChannelStatus.OPEN_WAIT);
        require(channels[id].opn_timeout >= now);
        
        channels[id].alice.addr.transfer(channels[id].alice.dep * 1 ether);
        
        channels[id].status = ChannelStatus.CLOSED;
        
        emit EventOpenChannelTimeout(id, msg.sender);
    }
    
    function close_channel(bytes32 id, uint chal_bal, uint other_bal, uint vn) public onlyAliceOrBob(id, msg.sender) {
        require(channels[id].status == ChannelStatus.OPEN);
        
        channels[id].chall.addr = msg.sender;
        channels[id].chall.chall_bal = chal_bal;
        channels[id].chall.other_bal = other_bal;
        channels[id].chall.vn = vn;
        channels[id].cls_timeout = now + channels[id].cls_timeout * 1 seconds;
        
        channels[id].status = ChannelStatus.CLOSE_WAIT;
        
        emit EventCloseChannel(id, msg.sender, chal_bal, other_bal, vn, channels[id].cls_timeout);
    }
    
    function close_channel_respond(bytes32 id, uint my_bal, uint other_bal, uint vn) public onlyAliceOrBob(id, msg.sender) {
        require(channels[id].chall.addr != msg.sender);
        require(channels[id].cls_timeout > now);
        require(channels[id].status == ChannelStatus.CLOSE_WAIT);
        
        channels[id].status = ChannelStatus.CLOSED;

        if(channels[id].chall.vn > vn) {
            channels[id].chall.addr.transfer(channels[id].chall.chall_bal * 1 ether);
            msg.sender.transfer(channels[id].chall.other_bal * 1 ether);
            
            emit EventCloseChannelRespond(id, channels[id].chall.addr, channels[id].chall.chall_bal, msg.sender, channels[id].chall.other_bal);
        } else {
            msg.sender.transfer(my_bal * 1 ether);
            channels[id].chall.addr.transfer(other_bal * 1 ether);
            
            emit EventCloseChannelRespond(id, channels[id].chall.addr, other_bal, msg.sender, my_bal);
        }
    }
    
    function close_channel_timeout(bytes32 id) public onlyAliceOrBob(id, msg.sender) {
        require(now >= channels[id].cls_timeout);
        require(channels[id].status == ChannelStatus.CLOSE_WAIT);
        
        channels[id].status = ChannelStatus.CLOSED;
        
        channels[id].chall.addr.transfer(channels[id].chall.chall_bal * 1 ether);
        if(channels[id].chall.addr == channels[id].alice.addr) {
            channels[id].bob.addr.transfer(channels[id].chall.other_bal * 1 ether);
            emit EventCloseChannelTimeout(id, channels[id].alice.addr, channels[id].chall.chall_bal, channels[id].bob.addr, channels[id].chall.other_bal);
        } else {
            channels[id].alice.addr.transfer(channels[id].chall.other_bal * 1 ether);
            emit EventCloseChannelTimeout(id, channels[id].bob.addr, channels[id].chall.chall_bal, channels[id].alice.addr, channels[id].chall.other_bal);
        }
    }
}