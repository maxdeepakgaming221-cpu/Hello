const FIXED_GROUP_ID = 'hello-dosto-permanent-group-2026-v3';
const CHUNK_SIZE = 64 * 1024; // 64KB chunks for 100% reliable HD video/file delivery

let peer = null;
let isHost = false;
let hostConn = null;
let guestConnections = [];
let activeUsers = [];
let readReceiptsMap = {};
let incomingFileBuffers = {}; // Reassembles chunked videos/files

let myName = localStorage.getItem('wa_device_username') || '';
let groupName = localStorage.getItem('wa_group_name') || 'Hello dosto 😊🙂';
let replyToMsg = null;
let typingTimeout = null;
let isDarkMode = false;

// Audio Recording
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// 1. Auto-Initialization on Load
window.onload = function() {
    document.getElementById('groupTitle').innerText = groupName;
    loadSavedChatHistory();

    if (!myName) {
        // Show name prompt over blurred chat if first time on this device
        document.getElementById('nameOverlayModal').classList.remove('hidden');
    } else {
        // Auto-connect immediately without asking name again
        connectToFixedGroup();
    }
};

function saveNameAndJoin() {
    const inputName = document.getElementById('userNameInput').value.trim();
    if (!inputName) {
        alert("कृपया अपना नाम लिखें!");
        return;
    }
    myName = inputName;
    localStorage.setItem('wa_device_username', myName);
    document.getElementById('nameOverlayModal').classList.add('hidden');
    connectToFixedGroup();
}

function changeMyName() {
    const newName = prompt("अपना नया नाम लिखें:", myName);
    if (newName && newName.trim() !== "") {
        const oldName = myName;
        myName = newName.trim();
        localStorage.setItem('wa_device_username', myName);
        const sysText = `👤 ${oldName} ने अपना नाम बदलकर "${myName}" रख लिया है।`;
        addSystemMessage(sysText);
        sendPayload({ type: 'name_changed', oldName, newName: myName });
    }
}

// 2. Seamless Host/Guest Connection (No manual room creation)
function connectToFixedGroup() {
    document.getElementById('statusText').innerText = "कनेक्ट हो रहा है...";
    const deviceUserId = 'dev-' + Math.floor(100000 + Math.random() * 900000);
    peer = new Peer(deviceUserId);

    peer.on('open', () => {
        hostConn = peer.connect(FIXED_GROUP_ID, { reliable: true });

        hostConn.on('open', () => {
            isHost = false;
            document.getElementById('statusText').innerText = "ऑनलाइन";
            hostConn.send({ type: 'join', sender: myName });
        });

        hostConn.on('data', (data) => {
            handleIncomingData(data);
        });

        hostConn.on('close', () => {
            document.getElementById('statusText').innerText = "पुनः जुड़ रहा है...";
            setTimeout(connectToFixedGroup, 2500);
        });
    });

    peer.on('error', (err) => {
        if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
            peer.destroy();
            becomeGroupHost();
        }
    });
}

function becomeGroupHost() {
    isHost = true;
    peer = new Peer(FIXED_GROUP_ID);

    peer.on('open', () => {
        activeUsers = [myName];
        updateOnlineCount();
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

            const msg = `${leftUser} ग्रुप से बाहर चले गए।`;
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

// 3. Incoming Data & Chunk Reassembly Handler
function handleIncomingData(data, senderPeerId = null) {
    if (data.type === 'join') {
        if (isHost && senderPeerId) {
            const c = guestConnections.find(x => x.peer === senderPeerId);
            if (c) c.userName = data.sender;
            if (!activeUsers.includes(data.sender)) activeUsers.push(data.sender);
            updateOnlineCount();
            broadcastUserList();
        }
        const msg = `${data.sender} ग्रुप में शामिल हुए।`;
        addSystemMessage(msg);
        if (isHost) broadcastToGuests({ type: 'system', text: msg }, senderPeerId);

    } else if (data.type === 'name_changed') {
        if (isHost) {
            activeUsers = activeUsers.map(u => u === data.oldName ? data.newName : u);
            broadcastUserList();
        }
        addSystemMessage(`👤 ${data.oldName} ने अपना नाम बदलकर "${data.newName}" रख लिया है।`);

    } else if (data.type === 'user_list') {
        activeUsers = data.users;
        document.getElementById('statusText').innerText = `${activeUsers.length} लोग ऑनलाइन हैं`;

    } else if (data.type === 'system') {
        addSystemMessage(data.text);

    } else if (data.type === 'text') {
        renderMessage(data, 'received', true);
        sendPayload({ type: 'read_receipt', msgId: data.id, reader: myName, readTime: getTime() });

    } else if (data.type === 'file_chunk') {
        handleIncomingFileChunk(data);

    } else if (data.type === 'read_receipt') {
        if (!readReceiptsMap[data.msgId]) readReceiptsMap[data.msgId] = [];
        if (!readReceiptsMap[data.msgId].some(r => r.reader === data.reader)) {
            readReceiptsMap[data.msgId].push({ reader: data.reader, time: data.readTime });
        }
        const tickEl = document.getElementById(`tick-${data.msgId}`);
        if (tickEl) {
            tickEl.innerText = '✓✓';
            tickEl.className = 'text-blue-500 font-bold ml-1';
        }

    } else if (data.type === 'typing') {
        const ind = document.getElementById('typingIndicator');
        ind.innerText = `${data.sender} लिख रहे हैं...`;
        ind.classList.remove('hidden');
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => ind.classList.add('hidden'), 2000);

    } else if (data.type === 'reaction') {
        applyReaction(data.msgId, data.emoji);

    } else if (data.type === 'delete_everyone') {
        applyDeleteEveryone(data.msgId);

    } else if (data.type === 'update_group_name') {
        groupName = data.name;
        localStorage.setItem('wa_group_name', groupName);
        document.getElementById('groupTitle').innerText = groupName;
        addSystemMessage(`📢 ग्रुप का नाम बदलकर "${groupName}" कर दिया गया है।`);

    } else if (data.type === 'sync_group_name') {
        groupName = data.name;
        localStorage.setItem('wa_group_name', groupName);
        document.getElementById('groupTitle').innerText = groupName;
    }
}

// Reassemble incoming HD video/file chunks
function handleIncomingFileChunk(data) {
    if (!incomingFileBuffers[data.id]) {
        incomingFileBuffers[data.id] = {
            chunks: new Array(data.totalChunks),
            receivedCount: 0,
            meta: data
        };
    }

    const record = incomingFileBuffers[data.id];
    record.chunks[data.chunkIndex] = data.chunkData;
    record.receivedCount++;

    if (record.receivedCount === data.totalChunks) {
        const fullBlob = new Blob(record.chunks, { type: data.fileType });
        const fileUrl = URL.createObjectURL(fullBlob);

        renderMessage({
            id: data.id,
            type: 'media',
            sender: data.sender,
            fileName: data.fileName,
            fileType: data.fileType,
            url: fileUrl,
            time: data.time,
            replyTo: data.replyTo
        }, 'received', false);

        sendPayload({ type: 'read_receipt', msgId: data.id, reader: myName, readTime: getTime() });
        delete incomingFileBuffers[data.id];
    }
}

// 4. Sending Text & Chunked HD Media
function getTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight) + 'px';
}

function handleTyping() {
    sendPayload({ type: 'typing', sender: myName });
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

    renderMessage(msgData, 'sent', true);
    sendPayload(msgData);
    
    input.value = '';
    input.style.height = 'auto';
    cancelReply();
}

// Chunked HD Video & File Sender
function sendMediaFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusBar = document.getElementById('uploadStatus');
    const percentEl = document.getElementById('uploadPercent');
    statusBar.classList.remove('hidden');
    percentEl.innerText = '0%';

    const msgId = 'msg-' + Date.now();
    readReceiptsMap[msgId] = [];
    const time = getTime();
    const localUrl = URL.createObjectURL(file);

    // Show immediately on sender's screen
    renderMessage({
        id: msgId, type: 'media', sender: myName,
        fileName: file.name, fileType: file.type || 'application/octet-stream',
        url: localUrl, time: time, replyTo: replyToMsg
    }, 'sent', false);

    // Slice file into 64KB chunks so large videos NEVER fail
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let currentChunk = 0;

    function sendNextChunk() {
        const start = currentChunk * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const blobSlice = file.slice(start, end);

        const reader = new FileReader();
        reader.onload = function(e) {
            sendPayload({
                type: 'file_chunk',
                id: msgId,
                sender: myName,
                fileName: file.name,
                fileType: file.type || 'application/octet-stream',
                time: time,
                replyTo: replyToMsg,
                chunkIndex: currentChunk,
                totalChunks: totalChunks,
                chunkData: e.target.result
            });

            currentChunk++;
            const progress = Math.round((currentChunk / totalChunks) * 100);
            percentEl.innerText = `${progress}%`;

            if (currentChunk < totalChunks) {
                setTimeout(sendNextChunk, 15); // Smooth non-blocking transfer
            } else {
                statusBar.classList.add('hidden');
                cancelReply();
            }
        };
        reader.readAsArrayBuffer(blobSlice);
    }

    sendNextChunk();
    event.target.value = ''; // Reset input
}

// Voice Note Recorder
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
                const file = new File([audioBlob], `Voice_${Date.now()}.webm`, { type: 'audio/webm' });
                sendMediaFile({ target: { files: [file] } });
            };
            mediaRecorder.start();
            isRecording = true;
            micBtn.innerText = "⏹️";
            micBtn.classList.add("text-red-600", "animate-pulse");
        } catch (err) {
            alert("माइक्रोफ़ोन की अनुमति दें!");
        }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        micBtn.innerText = "🎤";
        micBtn.classList.remove("text-red-600", "animate-pulse");
    }
}

// 5. WhatsApp Style Message Rendering & Full-Screen Preview
function addSystemMessage(text) {
    const container = document.getElementById('messagesContainer');
    const div = document.createElement('div');
    div.className = "bg-white/90 text-gray-600 self-center text-[11px] px-3 py-1 rounded-lg shadow-sm border border-gray-200 max-w-[90%] text-center";
    div.innerText = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function renderMessage(data, direction, saveToLocal = false) {
    if (saveToLocal && data.type === 'text') {
        saveMessageToHistory(data, direction);
    }

    const container = document.getElementById('messagesContainer');
    const wrapper = document.createElement('div');
    wrapper.id = data.id;
    wrapper.className = `msg-bubble relative max-w-[82%] px-3 py-2 rounded-2xl text-sm shadow-sm break-words ${
        direction === 'sent' ? 'bg-[#dcf8c6] text-gray-900 self-end rounded-tr-none' : 'bg-white text-gray-900 self-start rounded-tl-none border border-gray-200'
    }`;

    let html = '';
    if (direction === 'received') {
        html += `<div class="text-[11px] font-bold text-[#075e54] mb-0.5">${data.sender}</div>`;
    }

    if (data.replyTo) {
        html += `<div class="bg-black/5 border-l-3 border-[#00a884] p-1.5 rounded text-xs mb-1.5 text-gray-600">
                    <div class="font-bold text-[10px] text-[#00a884]">${data.replyTo.sender}</div>
                    <div class="truncate">${data.replyTo.text}</div>
                 </div>`;
    }

    if (data.type === 'text') {
        // Preserve paragraphs/newlines cleanly
        const formattedText = data.text.replace(/\n/g, '<br>');
        html += `<div id="body-${data.id}" class="leading-relaxed whitespace-pre-wrap">${formattedText}</div>`;
    } else if (data.type === 'media') {
        let mediaHtml = '';
        if (data.fileType.startsWith('video/')) {
            mediaHtml = `
                <div class="relative group cursor-pointer" onclick="openLightbox('${data.url}', 'video', '${data.fileName}')">
                    <video src="${data.url}" class="w-full rounded-xl max-h-60 bg-black object-cover"></video>
                    <div class="absolute inset-0 bg-black/30 flex items-center justify-center rounded-xl">
                        <span class="bg-white/90 text-black w-10 h-10 rounded-full flex items-center justify-center text-lg shadow">▶️</span>
                    </div>
                </div>`;
        } else if (data.fileType.startsWith('image/')) {
            mediaHtml = `<img src="${data.url}" onclick="openLightbox('${data.url}', 'image', '${data.fileName}')" class="w-full rounded-xl max-h-60 object-cover cursor-pointer hover:opacity-95 transition">`;
        } else if (data.fileType.startsWith('audio/')) {
            mediaHtml = `<div class="py-1"><audio src="${data.url}" controls></audio></div>`;
        } else {
            mediaHtml = `<div class="text-xs font-semibold text-gray-700 bg-black/5 p-2 rounded-lg">📄 ${data.fileName}</div>`;
        }

        html += `<div id="body-${data.id}">
                    ${mediaHtml}
                    <div class="flex justify-between items-center mt-1">
                        <span class="text-[10px] text-gray-500 truncate max-w-[140px]">${data.fileName}</span>
                        <a href="${data.url}" download="${data.fileName}" class="bg-black/10 hover:bg-black/20 p-1.5 rounded-full text-xs" title="डाउनलोड">⬇️</a>
                    </div>
                 </div>`;
    }

    const tickHtml = direction === 'sent' ? `<span id="tick-${data.id}" class="text-gray-400 ml-1">✓</span>` : '';
    html += `<div class="flex justify-end items-center space-x-1 mt-1 text-[10px] text-gray-500">
                <span>${data.time}</span>
                ${tickHtml}
             </div>`;

    html += `<div id="react-${data.id}" class="hidden absolute -bottom-2.5 right-2 bg-white border border-gray-300 rounded-full px-1.5 py-0.2 text-xs shadow"></div>`;

    // Action Bar
    const safeText = data.type === 'text' ? data.text.replace(/'/g, "\\'").replace(/\n/g, " ") : data.fileName;
    html += `<div class="msg-actions absolute -top-8 ${direction === 'sent' ? 'right-0' : 'left-0'} bg-white shadow-lg rounded-full px-2.5 py-1 space-x-2 text-xs border border-gray-200 z-20">
                <button onclick="sendReaction('${data.id}', '👍')">👍</button>
                <button onclick="sendReaction('${data.id}', '❤️')">❤️</button>
                <button onclick="sendReaction('${data.id}', '😂')">😂</button>
                <button onclick="setReply('${data.sender}', '${safeText}')">↩️</button>
                ${direction === 'sent' ? `<button onclick="showMessageInfo('${data.id}')" title="किसने पढ़ा">ℹ️</button>` : ''}
                ${direction === 'sent' ? `<button onclick="deleteForEveryone('${data.id}')" title="सबके लिए डिलीट" class="text-red-500 font-bold">❌</button>` : ''}
             </div>`;

    wrapper.innerHTML = html;
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

// Full-Screen Media Lightbox Functions
function openLightbox(url, type, title) {
    const modal = document.getElementById('mediaLightbox');
    const content = document.getElementById('lightboxContent');
    const dlBtn = document.getElementById('lightboxDownloadBtn');
    document.getElementById('lightboxTitle').innerText = title;
    dlBtn.href = url;
    dlBtn.download = title;

    if (type === 'image') {
        content.innerHTML = `<img src="${url}" class="max-h-full max-w-full object-contain rounded-lg">`;
    } else if (type === 'video') {
        content.innerHTML = `<video src="${url}" controls autoplay class="max-h-full max-w-full rounded-lg"></video>`;
    }
    modal.classList.remove('hidden');
}

function closeLightbox() {
    document.getElementById('mediaLightbox').classList.add('hidden');
    document.getElementById('lightboxContent').innerHTML = '';
}

// Local History Storage (So refresh keeps previous messages)
function saveMessageToHistory(data, direction) {
    let history = JSON.parse(localStorage.getItem('wa_chat_history') || '[]');
    history.push({ data, direction });
    if (history.length > 50) history.shift(); // Keep last 50 messages
    localStorage.setItem('wa_chat_history', JSON.stringify(history));
}

function loadSavedChatHistory() {
    let history = JSON.parse(localStorage.getItem('wa_chat_history') || '[]');
    history.forEach(item => {
        renderMessage(item.data, item.direction, false);
    });
}

function clearChatForMe() {
    if (confirm("क्या आप अपनी स्क्रीन से सभी मैसेज साफ करना चाहते हैं?")) {
        localStorage.removeItem('wa_chat_history');
        document.getElementById('messagesContainer').innerHTML = '';
        addSystemMessage("चैट साफ कर दी गई है।");
    }
}

// 6. Menu, Info, Delete & Theme Functions
function toggleThreeDotMenu() {
    document.getElementById('threeDotDropdown').classList.toggle('hidden');
}

function showMessageInfo(msgId) {
    const readers = readReceiptsMap[msgId] || [];
    document.getElementById('modalTitle').innerText = "संदेश विवरण";
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
    let bodyHtml = `<p class="font-bold text-[#00a884] mb-2">ऑनलाइन सदस्य (${list.length}):</p>`;
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
        localStorage.setItem('wa_group_name', groupName);
        document.getElementById('groupTitle').innerText = groupName;
        addSystemMessage(`📢 ग्रुप का नाम बदलकर "${groupName}" कर दिया गया है।`);
        sendPayload({ type: 'update_group_name', name: groupName });
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
        body.className = "bg-[#0b141a] flex justify-center items-center";
        container.className = "w-full max-w-2xl h-full bg-[#111b21] flex flex-col relative shadow-2xl overflow-hidden text-white";
        header.className = "bg-[#202c33] text-white px-3 py-2.5 flex items-center justify-between shadow-md z-30 shrink-0";
        inputBar.className = "bg-[#202c33] p-2 flex items-end space-x-1.5 z-20 border-t border-gray-800 shrink-0";
    } else {
        body.className = "bg-[#efeae2] flex justify-center items-center";
        container.className = "w-full max-w-2xl h-full bg-[#efeae2] flex flex-col relative shadow-2xl overflow-hidden text-gray-800";
        header.className = "bg-[#00a884] text-white px-3 py-2.5 flex items-center justify-between shadow-md z-30 shrink-0";
        inputBar.className = "bg-[#f0f2f5] p-2 flex items-end space-x-1.5 z-20 border-t border-gray-200 shrink-0";
    }
}
