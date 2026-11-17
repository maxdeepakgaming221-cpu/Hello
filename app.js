const PUBLIC_ROOM_ID = 'hello-dosto-group-room-2026-final';
let peer = null;
let isHost = false;
let hostConn = null;
let guestConnections = []; 
let activeUsers = []; // Tracks all online members
let readReceiptsMap = {}; // Tracks who read which message
let myName = '';
let groupName = 'Hello dosto 😊🙂';
let replyToMsg = null;
let typingTimeout = null;
let isDarkMode = false;

// Audio Recording variables
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// 1. Join Group
function joinPublicGroup() {
    myName = document.getElementById('userNameInput').value.trim();
    if (!myName) {
        alert("कृपया पहले अपना नाम लिखें!");
        return;
    }

    document.getElementById('setupScreen').classList.add('hidden');
    document.getElementById('chatScreen').classList.remove('hidden');
    document.getElementById('statusText').innerText = "कनेक्ट हो रहा है...";

    initPeerConnectionAsGuest();
}

function initPeerConnectionAsGuest() {
    const myRandomId = 'user-' + Math.floor(100000 + Math.random() * 900000);
    peer = new Peer(myRandomId);

    peer.on('open', () => {
        hostConn = peer.connect(PUBLIC_ROOM_ID);

        hostConn.on('open', () => {
            isHost = false;
            document.getElementById('statusText').innerText = "ऑनलाइन";
            hostConn.send({ type: 'join', sender: myName });
        });

        hostConn.on('data', (data) => {
            handleIncomingData(data);
        });

        hostConn.on('close', () => {
            document.getElementById('statusText').innerText = "पुनः कनेक्ट हो रहा है...";
            setTimeout(initPeerConnectionAsGuest, 3000);
        });
    });

    peer.on('error', (err) => {
        if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
            peer.destroy();
            initPeerConnectionAsHost();
        }
    });
}

function initPeerConnectionAsHost() {
    isHost = true;
    peer = new Peer(PUBLIC_ROOM_ID);

    peer.on('open', () => {
        activeUsers = [myName + " (Admin)"];
        updateOnlineCount();
        addSystemMessage(`आपने "${groupName}" ग्रुप शुरू किया है।`);
    });

    peer.on('connection', (conn) => {
        conn.on('open', () => {
            guestConnections.push(conn);
            conn.send({ type: 'sync_group_name', name: groupName });
            updateOnlineCount();
        });

        conn.on('data', (data) => {
            handleIncomingData(data, conn.peer);
            broadcastToGuests(data, conn.peer);
        });

        conn.on('close', () => {
            const leftUser = conn.userName || 'एक सदस्य';
            guestConnections = guestConnections.filter(c => c.peer !== conn.peer);
            activeUsers = activeUsers.filter(u => u !== leftUser);
            updateOnlineCount();
            broadcastUserList();

            const msg = `${leftUser} ग्रुप छोड़कर चले गए।`;
            addSystemMessage(msg);
            broadcastToGuests({ type: 'system', text: msg });
        });
    });
}

function broadcastToGuests(data, excludePeerId = null) {
    guestConnections.forEach(conn => {
        if (conn.open && conn.peer !== excludePeerId) {
            conn.send(data);
        }
    });
}

function broadcastUserList() {
    if (isHost) {
        broadcastToGuests({ type: 'user_list', users: activeUsers });
    }
}

function updateOnlineCount() {
    const total = guestConnections.length + 1;
    document.getElementById('statusText').innerText = `${total} लोग ऑनलाइन हैं`;
}

function sendPayload(payload) {
    if (isHost) {
        broadcastToGuests(payload);
    } else if (hostConn && hostConn.open) {
        hostConn.send(payload);
    }
}

// 2. Incoming Data Handler
function handleIncomingData(data, senderPeerId = null) {
    if (data.type === 'join') {
        if (isHost && senderPeerId) {
            const c = guestConnections.find(x => x.peer === senderPeerId);
            if (c) c.userName = data.sender;
            if (!activeUsers.includes(data.sender)) activeUsers.push(data.sender);
            updateOnlineCount();
            broadcastUserList();
        }
        const msg = `${data.sender} ग्रुप में शामिल हो गए हैं।`;
        addSystemMessage(msg);
        if (isHost) broadcastToGuests({ type: 'system', text: msg }, senderPeerId);

    } else if (data.type === 'user_list') {
        activeUsers = data.users;
        document.getElementById('statusText').innerText = `${activeUsers.length} लोग ऑनलाइन हैं`;

    } else if (data.type === 'system') {
        addSystemMessage(data.text);

    } else if (data.type === 'text') {
        renderMessage(data, 'received');
        sendPayload({ type: 'read_receipt', msgId: data.id, reader: myName, readTime: getTime() });

    } else if (data.type === 'media') {
        const blob = new Blob([data.file], { type: data.fileType });
        data.url = URL.createObjectURL(blob);
        renderMessage(data, 'received');
        sendPayload({ type: 'read_receipt', msgId: data.id, reader: myName, readTime: getTime() });

    } else if (data.type === 'read_receipt') {
        // Record who read the message
        if (!readReceiptsMap[data.msgId]) readReceiptsMap[data.msgId] = [];
        const alreadyRecorded = readReceiptsMap[data.msgId].some(r => r.reader === data.reader);
        if (!alreadyRecorded) {
            readReceiptsMap[data.msgId].push({ reader: data.reader, time: data.readTime });
        }
        // Turn tick to Blue
        const tickEl = document.getElementById(`tick-${data.msgId}`);
        if (tickEl) {
            tickEl.innerText = '✓✓';
            tickEl.className = 'text-blue-500 font-bold ml-1';
        }

    } else if (data.type === 'typing') {
        const ind = document.getElementById('typingIndicator');
        ind.innerText = `${data.sender} टाइप कर रहे हैं...`;
        ind.classList.remove('hidden');
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => ind.classList.add('hidden'), 2000);

    } else if (data.type === 'reaction') {
        applyReaction(data.msgId, data.emoji);

    } else if (data.type === 'delete_everyone') {
        applyDeleteEveryone(data.msgId);

    } else if (data.type === 'update_group_name') {
        groupName = data.name;
        document.getElementById('groupTitle').innerText = groupName;
        addSystemMessage(`📢 ग्रुप का नाम बदलकर "${groupName}" कर दिया गया है।`);

    } else if (data.type === 'sync_group_name') {
        groupName = data.name;
        document.getElementById('groupTitle').innerText = groupName;
    }
}

// 3. Messaging Actions
function getTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function handleTyping() {
    sendPayload({ type: 'typing', sender: myName });
}

function handleKeyPress(e) {
    if (e.key === 'Enter') sendMessage();
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;

    const msgId = 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    readReceiptsMap[msgId] = [];

    const msgData = {
        id: msgId,
        type: 'text',
        sender: myName,
        text: text,
        time: getTime(),
        replyTo: replyToMsg
    };

    renderMessage(msgData, 'sent');
    sendPayload(msgData);
    
    input.value = '';
    cancelReply();
}

function sendMediaFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('uploadStatus').classList.remove('hidden');
    const reader = new FileReader();

    reader.onload = function(e) {
        const msgId = 'msg-' + Date.now();
        readReceiptsMap[msgId] = [];
        const time = getTime();
        const localUrl = URL.createObjectURL(file);

        renderMessage({
            id: msgId, type: 'media', sender: myName,
            fileName: file.name, fileType: file.type || 'application/octet-stream',
            url: localUrl, time: time, replyTo: replyToMsg
        }, 'sent');

        sendPayload({
            id: msgId, type: 'media', sender: myName,
            file: e.target.result, fileName: file.name,
            fileType: file.type || 'application/octet-stream',
            time: time, replyTo: replyToMsg
        });

        document.getElementById('uploadStatus').classList.add('hidden');
        cancelReply();
    };
    reader.readAsArrayBuffer(file);
}

async function toggleAudioRecord() {
    const micBtn = document.getElementById('micBtn');
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = function(e) {
                    const msgId = 'msg-' + Date.now();
                    readReceiptsMap[msgId] = [];
                    const time = getTime();
                    const localUrl = URL.createObjectURL(audioBlob);

                    renderMessage({
                        id: msgId, type: 'media', sender: myName,
                        fileName: 'Voice_Note.webm', fileType: 'audio/webm',
                        url: localUrl, time: time
                    }, 'sent');

                    sendPayload({
                        id: msgId, type: 'media', sender: myName,
                        file: e.target.result, fileName: 'Voice_Note.webm',
                        fileType: 'audio/webm', time: time
                    });
                };
                reader.readAsArrayBuffer(audioBlob);
            };
            mediaRecorder.start();
            isRecording = true;
            micBtn.style.color = "red";
        } catch (err) {
            alert("माइक्रोफ़ोन की अनुमति दें!");
        }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        micBtn.style.color = "gray";
    }
}

// 4. UI Rendering
function addSystemMessage(text) {
    const container = document.getElementById('messagesContainer');
    const div = document.createElement('div');
    div.className = "bg-white/90 text-gray-600 self-center text-[11px] px-3 py-1 rounded-lg shadow-sm border border-gray-200 max-w-[90%] text-center";
    div.innerText = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function renderMessage(data, direction) {
    const container = document.getElementById('messagesContainer');
    const wrapper = document.createElement('div');
    wrapper.id = data.id;
    wrapper.className = `msg-bubble relative max-w-[82%] px-3 py-2 rounded-xl text-sm shadow-md break-words ${
        direction === 'sent' ? 'bg-[#dcf8c6] text-gray-800 self-end rounded-tr-none' : 'bg-white text-gray-800 self-start rounded-tl-none border border-gray-200'
    }`;

    let html = '';
    if (direction === 'received') {
        html += `<div class="text-[11px] font-bold text-[#075e54] mb-0.5">${data.sender}</div>`;
    }

    if (data.replyTo) {
        html += `<div class="bg-black/5 border-l-2 border-[#00a884] p-1.5 rounded text-xs mb-1 text-gray-600">
                    <div class="font-bold text-[10px] text-[#00a884]">${data.replyTo.sender}</div>
                    <div class="truncate">${data.replyTo.text}</div>
                 </div>`;
    }

    if (data.type === 'text') {
        html += `<div id="body-${data.id}" class="leading-relaxed">${data.text}</div>`;
    } else if (data.type === 'media') {
        let mediaHtml = '';
        if (data.fileType.startsWith('video/')) {
            mediaHtml = `<video src="${data.url}" controls class="w-full rounded-lg max-h-56 bg-black mb-1"></video>`;
        } else if (data.fileType.startsWith('image/')) {
            mediaHtml = `<img src="${data.url}" class="w-full rounded-lg max-h-56 object-cover mb-1">`;
        } else if (data.fileType.startsWith('audio/')) {
            mediaHtml = `<audio src="${data.url}" controls class="w-full mb-1"></audio>`;
        } else {
            mediaHtml = `<div class="text-xs font-bold text-blue-600 mb-1">📄 ${data.fileName}</div>`;
        }
        html += `<div id="body-${data.id}">
                    ${mediaHtml}
                    <a href="${data.url}" download="${data.fileName}" class="text-[11px] text-blue-600 font-bold underline">डाउनलोड करें ⬇️</a>
                 </div>`;
    }

    const tickHtml = direction === 'sent' ? `<span id="tick-${data.id}" class="text-gray-400 ml-1">✓</span>` : '';
    html += `<div class="flex justify-end items-center space-x-1 mt-1 text-[10px] text-gray-500">
                <span>${data.time}</span>
                ${tickHtml}
             </div>`;

    html += `<div id="react-${data.id}" class="hidden absolute -bottom-2.5 right-2 bg-white border border-gray-300 rounded-full px-1.5 py-0.2 text-xs shadow"></div>`;

    // Hover Action Bar (React, Reply, Message Info, Delete)
    const safeText = data.type === 'text' ? data.text.replace(/'/g, "\\'") : data.fileName;
    html += `<div class="reaction-picker absolute -top-8 ${direction === 'sent' ? 'right-0' : 'left-0'} bg-white shadow-lg rounded-full px-2.5 py-1 space-x-2 text-xs border border-gray-200 z-20">
                <button onclick="sendReaction('${data.id}', '👍')">👍</button>
                <button onclick="sendReaction('${data.id}', '❤️')">❤️</button>
                <button onclick="sendReaction('${data.id}', '😂')">😂</button>
                <button onclick="setReply('${data.sender}', '${safeText}')" title="रिप्लाई">↩️</button>
                ${direction === 'sent' ? `<button onclick="showMessageInfo('${data.id}')" title="किसने पढ़ा (Message Info)">ℹ️</button>` : ''}
                <button onclick="deleteForMe('${data.id}')" title="खुद के लिए डिलीट">🗑️</button>
                ${direction === 'sent' ? `<button onclick="deleteForEveryone('${data.id}')" title="सबके लिए डिलीट" class="text-red-500 font-bold">❌</button>` : ''}
             </div>`;

    wrapper.innerHTML = html;
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

// 5. Hidden Features & 3-Dot Menu Functions
function toggleThreeDotMenu() {
    document.getElementById('threeDotDropdown').classList.toggle('hidden');
}

function showMessageInfo(msgId) {
    const readers = readReceiptsMap[msgId] || [];
    document.getElementById('modalTitle').innerText = "संदेश विवरण (Message Info)";
    let bodyHtml = `<p class="font-bold text-blue-600 mb-2">✓✓ इन्होंने पढ़ लिया है:</p>`;
    if (readers.length === 0) {
        bodyHtml += `<p class="text-gray-500 italic">अभी तक किसी ने नहीं पढ़ा है।</p>`;
    } else {
        readers.forEach(r => {
            bodyHtml += `<div class="flex justify-between border-b py-1"><span>👤 ${r.reader}</span><span class="text-gray-500">${r.time}</span></div>`;
        });
    }
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('infoModal').classList.remove('hidden');
}

function showGroupInfoModal() {
    document.getElementById('modalTitle').innerText = `ग्रुप: ${groupName}`;
    const list = activeUsers.length > 0 ? activeUsers : [myName];
    let bodyHtml = `<p class="font-bold text-[#00a884] mb-2">वर्तमान ऑनलाइन सदस्य (${list.length}):</p>`;
    list.forEach(user => {
        bodyHtml += `<div class="py-1 border-b flex items-center space-x-2"><span>🟢</span><span>${user}</span></div>`;
    });
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('infoModal').classList.remove('hidden');
}

function closeInfoModal() {
    document.getElementById('infoModal').classList.add('hidden');
}

function editGroupName() {
    const newName = prompt("ग्रुप का नया नाम लिखें:", groupName);
    if (newName && newName.trim() !== "") {
        groupName = newName.trim();
        document.getElementById('groupTitle').innerText = groupName;
        addSystemMessage(`📢 आपने ग्रुप का नाम बदलकर "${groupName}" कर दिया है।`);
        sendPayload({ type: 'update_group_name', name: groupName });
    }
}

function clearChatForMe() {
    if (confirm("क्या आप अपनी स्क्रीन से सभी मैसेज साफ करना चाहते हैं?")) {
        document.getElementById('messagesContainer').innerHTML = '';
        addSystemMessage("चैट साफ कर दी गई है।");
    }
}

function leaveGroup() {
    if (confirm("क्या आप वाकई ग्रुप छोड़ना चाहते हैं?")) {
        location.reload();
    }
}

function setReply(sender, text) {
    replyToMsg = { sender, text };
    document.getElementById('replySender').innerText = sender;
    document.getElementById('replyText').innerText = text;
    document.getElementById('replyPreview').classList.remove('hidden');
    document.getElementById('messageInput').focus();
}

function cancelReply() {
    replyToMsg = null;
    document.getElementById('replyPreview').classList.add('hidden');
}

function sendReaction(msgId, emoji) {
    applyReaction(msgId, emoji);
    sendPayload({ type: 'reaction', msgId, emoji });
}

function applyReaction(msgId, emoji) {
    const el = document.getElementById(`react-${msgId}`);
    if (el) {
        el.innerText = emoji;
        el.classList.remove('hidden');
    }
}

function deleteForMe(msgId) {
    const el = document.getElementById(msgId);
    if (el) el.remove();
}

function deleteForEveryone(msgId) {
    applyDeleteEveryone(msgId);
    sendPayload({ type: 'delete_everyone', msgId });
}

function applyDeleteEveryone(msgId) {
    const bodyEl = document.getElementById(`body-${msgId}`);
    if (bodyEl) {
        bodyEl.innerHTML = `<span class="italic text-gray-400 text-xs">🚫 यह संदेश डिलीट कर दिया गया है</span>`;
    }
}

function toggleSearchBox() {
    const sb = document.getElementById('searchBarContainer');
    sb.classList.toggle('hidden');
    if (!sb.classList.contains('hidden')) {
        document.getElementById('searchInput').focus();
    }
}

function searchMessages(query) {
    const q = query.toLowerCase();
    const bubbles = document.querySelectorAll('.msg-bubble');
    bubbles.forEach(b => {
        const text = b.innerText.toLowerCase();
        b.style.display = (text.includes(q) || q === '') ? 'block' : 'none';
    });
}

function toggleTheme() {
    isDarkMode = !isDarkMode;
    const body = document.getElementById('bodyTheme');
    const container = document.getElementById('appContainer');
    const header = document.getElementById('headerTheme');
    const inputBar = document.getElementById('inputBarTheme');

    if (isDarkMode) {
        body.className = "h-screen flex items-center justify-center p-0 md:p-3 bg-[#0b141a] transition-colors duration-300";
        container.className = "w-full max-w-2xl h-full md:h-[96vh] bg-[#111b21] md:rounded-xl shadow-2xl flex flex-col overflow-hidden relative border border-gray-800 text-white";
        header.className = "bg-[#202c33] text-white p-3 flex items-center justify-between shadow-md z-30";
        inputBar.className = "bg-[#202c33] p-3 flex items-center space-x-2 z-20 border-t border-gray-800 text-white";
    } else {
        body.className = "h-screen flex items-center justify-center p-0 md:p-3 bg-[#efeae2] transition-colors duration-300";
        container.className = "w-full max-w-2xl h-full md:h-[96vh] bg-[#efeae2] md:rounded-xl shadow-2xl flex flex-col overflow-hidden relative border border-gray-300 text-gray-800";
        header.className = "bg-[#00a884] text-white p-3 flex items-center justify-between shadow-md z-30";
        inputBar.className = "bg-[#f0f2f5] p-3 flex items-center space-x-2 z-20 border-t border-gray-200 text-gray-800";
    }
}
