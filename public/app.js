import { CONTRACT_ADDRESS, ABI, PINATA_JWT } from "./constants.js";

let provider, signer, vaultContract, userAddress;
let countdownInterval;

// Global Tab Switch
window.switchTab = (tabId) => {
    ['assets', 'shared', 'security'].forEach(t => {
        document.getElementById(`tab-${t}`).classList.add('hidden');
        document.getElementById(`btn-tab-${t}`).classList.replace('tab-active', 'tab-inactive');
    });
    document.getElementById(`tab-${tabId}`).classList.remove('hidden');
    document.getElementById(`btn-tab-${tabId}`).classList.replace('tab-inactive', 'tab-active');
};

async function connectWallet() {
    if (!window.ethereum) return alert("MetaMask not found.");
    try {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = provider.getSigner();
        userAddress = await signer.getAddress();
        const network = await provider.getNetwork();
        const code = await provider.getCode(CONTRACT_ADDRESS);
        if (!code || code === '0x') {
            alert(`Contract not found on current network (chainId: ${network.chainId}). Please switch to the network where LegacyVault is deployed or update CONTRACT_ADDRESS.`);
            return;
        }
        vaultContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

        document.getElementById('view-landing').classList.add('hidden');
        document.getElementById('view-vault').classList.remove('hidden');
        document.getElementById('user-address').innerText = `${userAddress.slice(0,6)}...${userAddress.slice(-4)}`;
        
        await refreshAllData();
        
        // Listen for account changes
        window.ethereum.on('accountsChanged', () => window.location.reload());
    } catch (e) { console.error(e); }
}

async function refreshAllData() {
    await loadSettings();
    await loadMyDocs();
    await loadSharedDocs();
    await loadEmergencyContacts();
}

// 1. SECURITY LOGIC
async function loadSettings() {
    try {
        const s = await vaultContract.userSettings(userAddress);
        if (s.lastActive.isZero()) return;
        
        document.getElementById('timeout-select').value = s.inactivityTimeout.toNumber();
        startCountdown(s.lastActive.toNumber(), s.inactivityTimeout.toNumber());
    } catch (e) { console.error(e); }
}

function startCountdown(lastActive, inactivityTimeout) {
    if (countdownInterval) clearInterval(countdownInterval);
    const display = document.getElementById('countdown-timer');
    const gracePeriod = 30;

    countdownInterval = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        const mainExpiration = lastActive + inactivityTimeout;
        const graceExpiration = mainExpiration + gracePeriod;

        if (now >= graceExpiration) {
            display.innerText = "00:00:00:00";
            updateStatusUI("released");
            return;
        }

        const isGrace = now >= mainExpiration && now < graceExpiration;
        const timeLeft = isGrace ? (graceExpiration - now) : (mainExpiration - now);
        updateStatusUI(isGrace ? "grace" : "secured");

        const d = Math.floor(timeLeft / 86400);
        const h = Math.floor((timeLeft % 86400) / 3600);
        const m = Math.floor((timeLeft % 3600) / 60);
        const s = timeLeft % 60;
        display.innerText = `${d.toString().padStart(2, '0')}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }, 1000);
}

function updateStatusUI(state) {
    const badge = document.getElementById('status-badge');
    const dot = document.getElementById('pulse-dot');
    const phaseLabel = document.getElementById('phase-label');
    if (state === "released") {
        badge.innerHTML = `<span class="bg-red-100 text-red-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Vault Released</span>`;
        dot.className = "w-2 h-2 bg-red-500 rounded-full";
        phaseLabel.innerText = "Released";
    } else if (state === "grace") {
        badge.innerHTML = `<span class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Grace Window Active</span>`;
        dot.className = "w-2 h-2 bg-[#EAB308] rounded-full animate-pulse";
        phaseLabel.innerText = "Grace Time Remaining";
    } else {
        badge.innerHTML = `<span class="bg-emerald-100 text-emerald-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Vault Secured</span>`;
        dot.className = "w-2 h-2 bg-[#10B981] rounded-full animate-pulse";
        phaseLabel.innerText = "Time Until Vault Release";
    }
}

// EMERGENCY CONTACT LOGIC
async function addEmergencyContact() {
    const input = document.getElementById('emergency-email');
    const email = input.value.trim();
    if (!email || !email.includes('@')) return alert("Enter a valid email.");

    try {
        const tx = await vaultContract.addEmergencyContact(email);
        await tx.wait();
        input.value = "";
        await loadEmergencyContacts();
    } catch (e) { alert("Failed to add contact."); }
}

async function loadEmergencyContacts() {
    const list = document.getElementById('contact-list');
    try {
        const contacts = await vaultContract.getEmergencyContacts();
        list.innerHTML = contacts.length ? contacts.map(email => `
            <div class="flex justify-between items-center bg-white p-3 rounded-xl border border-zinc-100 shadow-sm">
                <span class="text-xs font-medium text-zinc-600">${email}</span>
                <button onclick="removeContact('${email}')" class="text-zinc-300 hover:text-red-500 transition">
                    <i class="fas fa-trash text-[10px]"></i>
                </button>
            </div>
        `).join('') : '<p class="text-[10px] text-zinc-400 italic">No emails added yet.</p>';
    } catch (e) { console.error(e); }
}

async function removeContact(email) {
    try {
        const tx = await vaultContract.removeEmergencyContact(email);
        await tx.wait();
        await loadEmergencyContacts();
    } catch (e) { alert("Failed to remove."); }
}

// 2. FILE HANDLING
async function handleUpload() {
    const fileInput = document.getElementById('file-upload');
    const title = document.getElementById('doc-name').value;
    const steps = document.getElementById('claim-steps').value;

    if (!fileInput.files[0] || !title) return alert("Fill all fields.");

    const legalConfirm = confirm("IMPORTANT LEGAL NOTICE:\n\nPhysical property ownership is not transferred by this app. Only file access is granted. Continue?");
    if (!legalConfirm) return;

    const status = document.getElementById('upload-status');
    status.classList.remove('hidden');

    try {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${PINATA_JWT}` },
            body: formData
        });
        const data = await res.json();
        const tx = await vaultContract.addDocument(data.IpfsHash, title, steps);
        await tx.wait();
        alert("Asset Sealed Successfully.");
        await refreshAllData();
    } catch (e) { alert("Upload failed."); }
    status.classList.add('hidden');
}

async function grantAccess() {
    const addr = document.getElementById('beneficiary-address').value.trim();
    const id = document.getElementById('selected-doc-id').value;
    if (!ethers.utils.isAddress(addr)) return alert("Invalid Wallet Address.");

    const confirmNominee = confirm("CRITICAL CHECK: Ensure this address belongs to the person in your physical will.");
    if (!confirmNominee) return;

    try {
        const tx = await vaultContract.grantAccess(addr, id);
        await tx.wait();
        alert("Access Rights Assigned.");
        await refreshAllData();
    } catch (e) { alert("Transaction failed."); }
}

// 3. UI RENDERING
async function loadMyDocs() {
    try {
        const docs = await vaultContract.getMyDocuments();
        const list = document.getElementById('my-docs-list');
        list.innerHTML = docs.length ? docs.map(d => `
            <div class="p-6 flex justify-between items-center hover:bg-zinc-50 transition">
                <div>
                    <p class="font-black text-sm uppercase tracking-tight">${d.title}</p>
                    <p class="text-[10px] text-zinc-400 font-mono">ID: ${d.id.toString()} | Hash: ${d.ipfsHash.slice(0,10)}...</p>
                </div>
                <a href="https://gateway.pinata.cloud/ipfs/${d.ipfsHash}" target="_blank" class="text-[10px] font-black text-black border-2 border-black px-4 py-2 rounded-full hover:bg-[#EAB308] hover:border-[#EAB308] transition">VIEW</a>
            </div>
        `).join('') : '<p class="p-10 text-center text-zinc-400 italic text-sm">Vault is empty.</p>';
    } catch (e) { console.error(e); }
}

async function loadSharedDocs() {
    try {
        const docs = await vaultContract.getSharedDocuments();
        const list = document.getElementById('shared-docs-list');
        list.innerHTML = docs.length ? docs.map(d => `
            <div class="p-8 bg-white border border-zinc-100 rounded-2xl shadow-sm">
                <h4 class="text-xl font-black mb-1 uppercase tracking-tighter">${d.title}</h4>
                <p class="text-[10px] text-[#EAB308] font-bold mb-6 uppercase tracking-widest">From: ${d.owner}</p>
                <div class="bg-zinc-50 p-6 rounded-2xl mb-6 border border-zinc-100">
                    <p class="text-[9px] uppercase font-black text-zinc-400 mb-2">Claim Instructions:</p>
                    <p class="text-sm text-zinc-600 leading-relaxed font-medium italic">"${d.claimProcess}"</p>
                </div>
                <a href="https://gateway.pinata.cloud/ipfs/${d.ipfsHash}" target="_blank" class="inline-block px-8 py-3 bg-black text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-[#EAB308] hover:text-black transition">Access Secret File</a>
            </div>
        `).join('') : '<p class="p-10 text-center text-zinc-400 italic text-sm">No assets have been released to you yet.</p>';
    } catch (e) { console.error(e); }
}

async function pingAlive() {
    try {
        const tx = await vaultContract.pingAlive();
        await tx.wait();
        alert("Activity Confirmed. Timer Reset.");
        await refreshAllData();
    } catch (e) { console.error(e); }
}

async function updateTimeout() {
    try {
        const seconds = document.getElementById('timeout-select').value;
        const tx = await vaultContract.setTimeout(seconds);
        await tx.wait();
        alert("Delay period updated.");
        await refreshAllData();
    } catch (e) { alert("Failed to update."); }
}

// Window Exports
window.connectWallet = connectWallet;
window.pingAlive = pingAlive;
window.updateTimeout = updateTimeout;
window.handleUpload = handleUpload;
window.grantAccess = grantAccess;
window.loadMyDocs = loadMyDocs;
window.addEmergencyContact = addEmergencyContact;
window.removeContact = removeContact;
