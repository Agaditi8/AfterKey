// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract LegacyVault {
    error NotOwner();
    error InvalidAddress();
    error Unauthorized();

    uint256 private constant GRACE_PERIOD = 30;
    struct Document {
        uint256 id;
        string ipfsHash;
        string title;
        string claimProcess;
        address owner;
        uint256 timestamp;
    }

    struct UserSettings {
        uint256 lastActive;
        uint256 inactivityTimeout; 
    }

    uint256 public documentCount;
    mapping(uint256 => Document) public documents;
    mapping(address => UserSettings) public userSettings;
    mapping(uint256 => mapping(address => bool)) public accessList;
    mapping(address => uint256[]) private ownerToDocs;
    mapping(address => uint256[]) private sharedWithMe;

    event DocumentAdded(uint256 indexed id, address indexed owner, string ipfsHash);
    event AccessGranted(uint256 indexed id, address indexed beneficiary);
    event Heartbeat(address indexed user, uint256 timestamp);

    // Modifier to reset the timer every time the owner interacts with the contract
    modifier updateActivity() {
        if (userSettings[msg.sender].lastActive == 0) {
            userSettings[msg.sender].inactivityTimeout = 7776000; // Default 90 days
        }
        userSettings[msg.sender].lastActive = block.timestamp;
        _;
    }

    function addDocument(
        string calldata _ipfsHash, 
        string calldata _title, 
        string calldata _claimProcess
    ) external updateActivity {
        documentCount++;
        
        documents[documentCount] = Document({
            id: documentCount,
            ipfsHash: _ipfsHash,
            title: _title,
            claimProcess: _claimProcess,
            owner: msg.sender,
            timestamp: block.timestamp
        });

        ownerToDocs[msg.sender].push(documentCount);
        emit DocumentAdded(documentCount, msg.sender, _ipfsHash);
    }

    function grantAccess(address _beneficiary, uint256 _docId) external updateActivity {
        if (documents[_docId].owner != msg.sender) revert NotOwner();
        if (_beneficiary == address(0)) revert InvalidAddress();

        if (!accessList[_docId][_beneficiary]) {
            accessList[_docId][_beneficiary] = true;
            sharedWithMe[_beneficiary].push(_docId);
        }
        emit AccessGranted(_docId, _beneficiary);
    }

    function pingAlive() external updateActivity {
        emit Heartbeat(msg.sender, block.timestamp);
    }

    function setTimeout(uint256 _seconds) external updateActivity {
        userSettings[msg.sender].inactivityTimeout = _seconds;
    }

    function getMyDocuments() external view returns (Document[] memory) {
        uint256[] storage ids = ownerToDocs[msg.sender];
        Document[] memory myDocs = new Document[](ids.length);

        for (uint256 i = 0; i < ids.length; i++) {
            myDocs[i] = documents[ids[i]];
        }
        return myDocs;
    }

    // Filtered View: Beneficiaries only see docs if the owner has crossed the timeout
    function getSharedDocuments() external view returns (Document[] memory) {
        if (userSettings[msg.sender].inactivityTimeout == 0) {
            return new Document[](0);
        }
        uint256[] storage ids = sharedWithMe[msg.sender];
        
        uint256 unlockedCount = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            address owner = documents[ids[i]].owner;
            if (block.timestamp > userSettings[owner].lastActive + userSettings[owner].inactivityTimeout + GRACE_PERIOD) {
                unlockedCount++;
            }
        }

        Document[] memory visibleDocs = new Document[](unlockedCount);
        uint256 currentIndex = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            address owner = documents[ids[i]].owner;
            if (block.timestamp > userSettings[owner].lastActive + userSettings[owner].inactivityTimeout + GRACE_PERIOD) {
                visibleDocs[currentIndex] = documents[ids[i]];
                currentIndex++;
            }
        }
        return visibleDocs;
    }
    // Inside your Smart Contract
    mapping(address => string[]) private userContacts;

    function addEmergencyContact(string memory _email) public {
        userContacts[msg.sender].push(_email);
    }

    function getEmergencyContacts() public view returns (string[] memory) {
        return userContacts[msg.sender];
    }

    function removeEmergencyContact(string memory _email) public {
        string[] storage contacts = userContacts[msg.sender];
        for (uint i = 0; i < contacts.length; i++) {
            if (keccak256(bytes(contacts[i])) == keccak256(bytes(_email))) {
                contacts[i] = contacts[contacts.length - 1];
                contacts.pop();
                break;
            }
        }
    }
}
