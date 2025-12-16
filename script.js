/* Version: #33 */

// === KONFIGURASJON ===
const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_VOLUME_THRESHOLD = 0.02; 
const WHITE_KEY_WIDTH = 40; 
const BLACK_KEY_WIDTH = 24; 
const MIC_STABILITY_THRESHOLD = 5; 
const SCROLL_SMOOTHING = 0.1; 
const SCROLL_TRIGGER_MARGIN = 150; 

// === GLOBALE VARIABLER ===
let VF = null; 
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let isListening = false;
let rafID = null; 
let buflen = 2048;
let buf = new Float32Array(buflen);
let currentActiveKey = null; 
const activeOscillators = new Map(); 

// MUSIC DATA
let recordedSequence = []; 
let currentDuration = "q"; 
let isDotted = false;
let bpm = 100;
let timeSignature = "4/4"; 
let metronomeEnabled = false;

// INTERACTION STATE
let selectedNoteIndex = -1;

// GAME STATE
let isRecording = false;
let isChallenging = false;
let challengeIndex = 0;
let isPlayingSequence = false; 

// Mic
let micPendingNote = null;
let micStableFrames = 0;
let lastRegisteredNote = null; 

// Scroll
let targetScrollPos = 0;
let pianoContainerWidth = 0;

// === DOM ELEMENTER ===
const btnStartMic = document.getElementById('btn-start-mic');
const displayStatus = document.getElementById('status-display');
const displayNote = document.getElementById('note-display');
const logContainer = document.getElementById('app-log');
const pianoContainer = document.getElementById('piano-container');
const pianoInner = document.getElementById('piano');

const vexWrapper = document.getElementById('vexflow-wrapper');
const btnClearSheet = document.getElementById('btn-clear-sheet');
const btnDownload = document.getElementById('btn-download');

// Settings
const bpmInput = document.getElementById('bpm-input');
const timeSigInput = document.getElementById('time-sig-input');
const btnToggleMetronome = document.getElementById('btn-toggle-metronome');
const btnAddRest = document.getElementById('btn-add-rest');
const btnToggleDot = document.getElementById('btn-toggle-dot');
const btnUndo = document.getElementById('btn-undo');
const contextMenu = document.getElementById('note-context-menu');

const mainControls = document.getElementById('main-controls');
const gameControls = document.getElementById('game-controls');
const learningStatus = document.getElementById('learning-status');

const btnRecord = document.getElementById('btn-record');
const btnPlaySeq = document.getElementById('btn-play-seq');
const btnChallenge = document.getElementById('btn-challenge');
const btnRestartGame = document.getElementById('btn-restart-game');
const btnStopGame = document.getElementById('btn-stop-game');

// === INIT ===
window.onload = () => {
    if (typeof Vex === 'undefined') {
        log("FEIL: VexFlow ble ikke lastet.");
        return;
    }
    VF = Vex.Flow; 
    generatePiano();
    pianoContainerWidth = pianoContainer.clientWidth;
    setTimeout(() => scrollToMiddleImmediate(), 100);
    requestAnimationFrame(updateScrollLoop);
    renderSheetMusic();
    updateButtonStates();
    
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target) && !e.target.closest('.vf-stavenote')) {
            closeContextMenu();
        }
    });
    
    log("Klar.");
};

window.onresize = () => {
    pianoContainerWidth = pianoContainer.clientWidth;
    renderSheetMusic(); 
};

// === INPUT LISTENERS ===
window.addEventListener('keydown', (e) => {
    if(e.target.tagName === 'INPUT') return; 

    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        targetScrollPos -= 100;
        if(targetScrollPos < 0) targetScrollPos = 0;
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        targetScrollPos += 100; 
        const max = pianoContainer.scrollWidth - pianoContainer.clientWidth;
        if(targetScrollPos > max) targetScrollPos = max;
    }

    switch(e.key.toLowerCase()) {
        case '1': setDuration('w', 'dur-1'); break;
        case '2': setDuration('h', 'dur-2'); break;
        case '4': setDuration('q', 'dur-4'); break;
        case '8': setDuration('8', 'dur-8'); break;
        case '9': setDuration('16', 'dur-9'); break;
        case 'p': addRest(); break;
        case '.': toggleDot(); break;
        case 'z': undoLastNote(); break;
    }
});

function setDuration(dur, elementId) {
    currentDuration = dur;
    document.querySelectorAll('.duration-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(elementId).classList.add('active');
    if(isDotted) btnToggleDot.classList.add('active');
}

document.getElementById('dur-1').onclick = () => setDuration('w', 'dur-1');
document.getElementById('dur-2').onclick = () => setDuration('h', 'dur-2');
document.getElementById('dur-4').onclick = () => setDuration('q', 'dur-4');
document.getElementById('dur-8').onclick = () => setDuration('8', 'dur-8');
document.getElementById('dur-9').onclick = () => setDuration('16', 'dur-9');

btnToggleDot.addEventListener('click', toggleDot);
function toggleDot() {
    isDotted = !isDotted;
    btnToggleDot.classList.toggle('active', isDotted);
    log(`Punktering: ${isDotted ? "PÅ" : "AV"}`);
}

btnUndo.addEventListener('click', undoLastNote);
function undoLastNote() {
    if (recordedSequence.length > 0) {
        recordedSequence.pop();
        log("Angret siste note.");
        renderSheetMusic();
        updateButtonStates();
    }
}

btnAddRest.addEventListener('click', addRest);
function addRest() {
    if (!isRecording) {
        log("Start opptak for å legge til pauser.");
        return;
    }
    recordedSequence.push({ 
        note: "b/4", 
        duration: currentDuration, 
        type: "r",
        dotted: isDotted
    });
    log("La til pause");
    renderSheetMusic();
    updateButtonStates();
}

bpmInput.addEventListener('change', (e) => {
    bpm = parseInt(e.target.value);
    if(bpm < 40) bpm = 40; if(bpm > 240) bpm = 240;
});
timeSigInput.addEventListener('change', (e) => {
    timeSignature = e.target.value;
    renderSheetMusic(); 
});
btnToggleMetronome.addEventListener('click', () => {
    metronomeEnabled = !metronomeEnabled;
    btnToggleMetronome.innerText = metronomeEnabled ? "På" : "Av";
    btnToggleMetronome.classList.toggle('on', metronomeEnabled);
});


// === VEXFLOW RENDERER & INTERACTION ===
function renderSheetMusic() {
    if (!VF) return; 
    
    while (vexWrapper.firstChild) {
        vexWrapper.removeChild(vexWrapper.firstChild);
    }
    
    const availableWidth = vexWrapper.clientWidth - 20; 
    const staveX = 10;
    let staveY = 20; 
    const lineSpacing = 120; 

    const renderer = new VF.Renderer(vexWrapper, VF.Renderer.Backends.SVG);
    renderer.resize(availableWidth, 500); 
    const context = renderer.getContext();

    const tsParts = timeSignature.split('/');
    const beatsPerMeasure = parseInt(tsParts[0]);
    const beatUnit = parseInt(tsParts[1]); 

    // 1. Build StaveNotes
    const allNotes = recordedSequence.map((item, index) => {
        let vfKey = "b/4"; 
        let accidental = "";
        
        if (item.type !== 'r') {
            const regex = /([A-G])(#?)(-?\d+)/;
            const match = item.note.match(regex);
            if (match) {
                vfKey = `${match[1].toLowerCase()}${match[2]}/${match[3]}`;
                accidental = match[2];
            }
        }

        const noteStruct = { 
            keys: [vfKey], 
            duration: item.duration + (item.type === 'r' ? "r" : ""), 
            auto_stem: true 
        };
        if (item.dotted) noteStruct.dots = 1;

        const staveNote = new VF.StaveNote(noteStruct);
        if (accidental) staveNote.addModifier(0, new VF.Accidental(accidental));
        if (item.dotted) staveNote.addDot(0);

        if (isChallenging) {
            if (index < challengeIndex) staveNote.setStyle({fillStyle: "#4caf50", strokeStyle: "#4caf50"});
            else if (index === challengeIndex) staveNote.setStyle({fillStyle: "#2196f3", strokeStyle: "#2196f3"});
        }
        
        let val = 0;
        switch(item.duration) {
            case 'w': val = 4; break;
            case 'h': val = 2; break;
            case 'q': val = 1; break;
            case '8': val = 0.5; break;
            case '16': val = 0.25; break;
            default: val = 1;
        }
        if (item.dotted) val *= 1.5;
        
        return { note: staveNote, beats: val };
    });

    // 2. Measure Grouping
    let measures = [];
    let currentMeasure = [];
    let currentBeats = 0;

    allNotes.forEach((obj) => {
        if (currentBeats + obj.beats > beatsPerMeasure + 0.01) {
            measures.push(currentMeasure);
            currentMeasure = [];
            currentBeats = 0;
        }
        currentMeasure.push(obj.note);
        currentBeats += obj.beats;
    });
    if (currentMeasure.length > 0) measures.push(currentMeasure);

    // 3. Draw
    const measureWidth = 250; 
    const measuresPerLine = Math.floor(availableWidth / measureWidth);
    let measureIndex = 0;
    
    while (measureIndex < measures.length) {
        let x = staveX + ((measureIndex % measuresPerLine) * measureWidth);
        let y = staveY + (Math.floor(measureIndex / measuresPerLine) * lineSpacing);
        
        let stave = new VF.Stave(x, y, measureWidth);
        if (measureIndex === 0 || measureIndex % measuresPerLine === 0) {
            stave.addClef("treble");
            if (measureIndex === 0) stave.addTimeSignature(timeSignature);
        }
        stave.setContext(context).draw();
        
        // --- FIX FOR SPACING (Luft rundt notene) ---
        // 1. Skyv startpunktet for notene mot høyre (15px padding)
        stave.setNoteStartX(stave.getNoteStartX() + 15);
        
        const notesInMeasure = measures[measureIndex];
        const beams = VF.Beam.generateBeams(notesInMeasure);
        
        const voice = new VF.Voice({num_beats: beatsPerMeasure, beat_value: beatUnit});
        voice.setStrict(false); 
        voice.addTickables(notesInMeasure);
        
        // 2. Reduser bredden formateren bruker, så vi ikke treffer høyre kant (-50px)
        new VF.Formatter().joinVoices([voice]).format([voice], measureWidth - 50);
        
        voice.draw(context, stave);
        beams.forEach(b => b.setContext(context).draw());

        measureIndex++;
        renderer.resize(availableWidth, y + 150);
    }

    // 4. ATTACH CLICK LISTENERS
    const renderedNotes = vexWrapper.querySelectorAll('.vf-stavenote');
    renderedNotes.forEach((el, index) => {
        if (index < recordedSequence.length) {
            el.addEventListener('click', (e) => {
                e.stopPropagation(); 
                openContextMenu(index, e);
            });
        }
    });
}

// === CONTEXT MENU LOGIC ===
function openContextMenu(index, event) {
    selectedNoteIndex = index;
    const noteData = recordedSequence[index];
    const x = event.pageX;
    const y = event.pageY;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.display = 'block';
    log(`Valgte note ${index + 1}`);
}

function closeContextMenu() {
    contextMenu.style.display = 'none';
    selectedNoteIndex = -1;
}

window.modifySelectedNote = function(action, value) {
    if (selectedNoteIndex === -1) return;
    const note = recordedSequence[selectedNoteIndex];

    if (action === 'duration') {
        note.duration = value;
    } else if (action === 'dot') {
        note.dotted = !note.dotted;
    } else if (action === 'type') {
        note.type = (note.type === 'n') ? 'r' : 'n';
        if (note.type === 'r') note.note = "b/4";
        if (note.type === 'n' && note.note === "b/4") note.note = "C4"; 
    } else if (action === 'delete') {
        recordedSequence.splice(selectedNoteIndex, 1);
        selectedNoteIndex = -1; 
    }
    renderSheetMusic();
    closeContextMenu();
};


// === INPUT HANDLING ===
function handleInput(noteId, freq, isClick) {
    if (isClick) playTone(noteId, freq); 

    if (isRecording) {
        recordedSequence.push({ 
            note: noteId, 
            duration: currentDuration, 
            type: 'n',
            dotted: isDotted
        });
        log(`Tatt opp: ${noteId}`);
        renderSheetMusic();
        updateButtonStates();
    } else if (isChallenging) {
        checkPlayerInput(noteId);
    }
}

function checkPlayerInput(noteId) {
    if (challengeIndex >= recordedSequence.length) return;
    const target = recordedSequence[challengeIndex];
    if (target.type === 'r') {
        challengeIndex++;
        checkPlayerInput(noteId); 
        return;
    }
    const keyElement = document.getElementById(`key-${noteId}`);
    if (noteId === target.note) {
        if (keyElement) { keyElement.classList.add('correct'); setTimeout(()=>keyElement.classList.remove('correct'), 300); }
        challengeIndex++;
        renderSheetMusic();
        if (challengeIndex >= recordedSequence.length) {
            learningStatus.innerText = "🏆 Ferdig!";
            clearHints();
        } else {
            showNextHint();
        }
    } else {
        if (keyElement) { keyElement.classList.add('wrong'); setTimeout(()=>keyElement.classList.remove('wrong'), 300); }
    }
}

function ensureAudioContext() {
    if (!audioContext) { audioContext = new (window.AudioContext || window.webkitAudioContext)(); }
    if (audioContext.state === 'suspended') { audioContext.resume(); }
    return audioContext;
}
function generatePiano() {
    pianoInner.innerHTML = ''; let whiteKeyCount = 0;
    for (let i = 21; i <= 108; i++) {
        const noteName = NOTE_STRINGS[i % 12]; const octave = Math.floor(i / 12) - 1; const noteId = noteName + octave; 
        const frequency = 440 * Math.pow(2, (i - 69) / 12); const isBlack = noteName.includes('#');
        const key = document.createElement('div'); key.id = `key-${noteId}`; key.dataset.note = noteId;
        if (isBlack) { key.className = 'key black'; key.style.left = `${(whiteKeyCount * WHITE_KEY_WIDTH) - (BLACK_KEY_WIDTH / 2)}px`; } 
        else { key.className = 'key white'; whiteKeyCount++; }
        const start = (e) => { e.preventDefault(); handleInput(noteId, frequency, true); };
        const end = () => stopTone(noteId);
        const touchStart = (e) => { if (e.touches.length > 1) return; e.preventDefault(); handleInput(noteId, frequency, true); };
        key.addEventListener('mousedown', start); key.addEventListener('mouseup', end); key.addEventListener('mouseleave', end);
        key.addEventListener('touchstart', touchStart, { passive: false }); key.addEventListener('touchend', end);
        pianoInner.appendChild(key);
    }
}
function scrollToMiddleImmediate() { const el = document.getElementById('key-C4'); if(el) { const centerPos = el.offsetLeft - (pianoContainerWidth/2) + 20; pianoContainer.scrollLeft = centerPos; targetScrollPos = centerPos; } }
function updateScrollLoop() {
    if (currentActiveKey) {
        const center = currentActiveKey.offsetLeft + (currentActiveKey.classList.contains('black')?12:20);
        const rel = center - pianoContainer.scrollLeft;
        if (rel < SCROLL_TRIGGER_MARGIN || rel > pianoContainerWidth - SCROLL_TRIGGER_MARGIN) targetScrollPos = center - (pianoContainerWidth / 2);
    }
    const diff = targetScrollPos - pianoContainer.scrollLeft;
    if (Math.abs(diff) > 1) pianoContainer.scrollLeft += diff * SCROLL_SMOOTHING; else pianoContainer.scrollLeft = targetScrollPos;
    requestAnimationFrame(updateScrollLoop);
}
btnPlaySeq.addEventListener('click', async () => {
    if (recordedSequence.length === 0) return;
    isPlayingSequence = true; updateButtonStates(); learningStatus.innerText = "Spiller av..."; clearHints();
    const msPerBeat = 60000 / bpm;
    for (let i = 0; i < recordedSequence.length; i++) {
        const item = recordedSequence[i];
        let noteBeats = 1; 
        switch(item.duration) { case 'w': noteBeats = 4; break; case 'h': noteBeats = 2; break; case 'q': noteBeats = 1; break; case '8': noteBeats = 0.5; break; case '16': noteBeats = 0.25; break; }
        if (item.dotted) noteBeats *= 1.5;
        const durationMs = noteBeats * msPerBeat;
        if (metronomeEnabled) playClick();
        if (item.type !== 'r') playDemoTone(item.note, durationMs);
        await new Promise(r => setTimeout(r, durationMs));
    }
    isPlayingSequence = false; learningStatus.innerText = "Ferdig spilt."; updateButtonStates();
});
function playClick() {
    const ctx = ensureAudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(1000, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime); osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.05);
}
function playDemoTone(noteId, durationMs) {
    const playDur = durationMs * 0.9; 
    const regex = /([A-G]#?)(-?\d+)/; const match = noteId.match(regex); if (!match) return;
    const freq = 440 * Math.pow(2, (((parseInt(match[2]) + 1) * 12 + NOTE_STRINGS.indexOf(match[1])) - 69) / 12);
    const ctx = ensureAudioContext(); const osc = ctx.createOscillator(); const gainNode = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gainNode.gain.setValueAtTime(0, ctx.currentTime); gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.02);
    gainNode.gain.setValueAtTime(0.5, ctx.currentTime + (playDur/1000) - 0.05); gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + (playDur/1000));
    osc.connect(gainNode); gainNode.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + (playDur/1000) + 0.1);
    const key = document.getElementById(`key-${noteId}`); if (key) key.classList.add('active');
    setTimeout(() => { if (key) key.classList.remove('active'); }, playDur);
}
function playTone(noteId, freq) {
    if(activeOscillators.has(noteId)) return;
    const ctx = ensureAudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime+0.05);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(); activeOscillators.set(noteId, {osc, gain});
    const k = document.getElementById(`key-${noteId}`); if(k) k.classList.add('active');
}
function stopTone(noteId) {
    if(!activeOscillators.has(noteId)) return;
    const {osc, gain} = activeOscillators.get(noteId); const ctx = audioContext;
    gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.1); osc.stop(ctx.currentTime+0.1);
    setTimeout(()=>{osc.disconnect(); gain.disconnect();}, 150); activeOscillators.delete(noteId);
    const k = document.getElementById(`key-${noteId}`); if(k && !isPlayingSequence) k.classList.remove('active');
}
btnRecord.addEventListener('click', () => { isRecording = !isRecording; if(isRecording) { recordedSequence=[]; isChallenging=false; learningStatus.innerText="🔴 Tar opp..."; } else learningStatus.innerText="Opptak ferdig."; renderSheetMusic(); updateButtonStates(); });
btnChallenge.addEventListener('click', () => { if(!recordedSequence.length) return; isChallenging=true; isRecording=false; challengeIndex=0; mainControls.style.display='none'; gameControls.style.display='flex'; renderSheetMusic(); showNextHint(); });
btnStopGame.addEventListener('click', () => { isChallenging=false; mainControls.style.display='flex'; gameControls.style.display='none'; clearHints(); renderSheetMusic(); });
btnClearSheet.addEventListener('click', ()=>{ recordedSequence=[]; renderSheetMusic(); updateButtonStates(); });
btnRestartGame.addEventListener('click', ()=>{ challengeIndex=0; renderSheetMusic(); showNextHint(); });
btnDownload.addEventListener('click', () => {
    if (!recordedSequence.length) { alert("Ingen noter å lagre!"); return; }
    const svgElement = vexWrapper.querySelector('svg'); if (!svgElement) return;
    if (!svgElement.hasAttribute("xmlns")) { svgElement.setAttribute("xmlns", "http://www.w3.org/2000/svg"); }
    if (!svgElement.hasAttribute("xmlns:xlink")) { svgElement.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink"); }
    const serializer = new XMLSerializer(); let svgString = serializer.serializeToString(svgElement);
    svgString = '<?xml version="1.0" standalone="no"?>\r\n' + svgString;
    const blob = new Blob([svgString], {type: "image/svg+xml;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a"); downloadLink.href = url; downloadLink.download = "noter.svg";
    document.body.appendChild(downloadLink); downloadLink.click(); document.body.removeChild(downloadLink);
    log("Lastet ned SVG.");
});

function updateButtonStates() { btnRecord.innerText = isRecording ? "⏹ Stopp" : "⏺ Opptak"; btnRecord.classList.toggle('active', isRecording); btnPlaySeq.disabled = isRecording || !recordedSequence.length; btnChallenge.disabled = isRecording || !recordedSequence.length; btnDownload.disabled = !recordedSequence.length; }
function clearHints() { document.querySelectorAll('.key').forEach(k=>k.classList.remove('hint')); }
function showNextHint() { clearHints(); if(challengeIndex<recordedSequence.length && recordedSequence[challengeIndex].type !== 'r') { const k = document.getElementById(`key-${recordedSequence[challengeIndex].note}`); if(k) k.classList.add('hint'); } }
btnStartMic.addEventListener('click', () => { if(isListening) { isListening=false; btnStartMic.innerText="Start Mikrofon"; } else startPitchDetect(); });
function startPitchDetect() { ensureAudioContext(); navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true}}).then(s=>{ isListening=true; btnStartMic.innerText="Stopp Mikrofon"; mediaStreamSource=audioContext.createMediaStreamSource(s); analyser=audioContext.createAnalyser(); analyser.fftSize=2048; mediaStreamSource.connect(analyser); updatePitch(); }).catch(e=>log("Mic Error: "+e)); }
function updatePitch() { if(!isListening) return; analyser.getFloatTimeDomainData(buf); const ac=autoCorrelate(buf, audioContext.sampleRate); if(ac===-1) { micStableFrames=0; micPendingNote=null; if(currentActiveKey && !activeOscillators.size) { currentActiveKey.classList.remove('active'); currentActiveKey=null; } } else { const n=noteFromPitch(ac); const name=NOTE_STRINGS[n%12], oct=Math.floor(n/12)-1, id=name+oct; displayNote.innerText=`${id} (${Math.round(ac)}Hz)`; if(id===micPendingNote) micStableFrames++; else { micPendingNote=id; micStableFrames=0; } const k=document.getElementById(`key-${id}`); if(k) { if(currentActiveKey && currentActiveKey!==k) currentActiveKey.classList.remove('active'); k.classList.add('active'); currentActiveKey=k; } if(micStableFrames>MIC_STABILITY_THRESHOLD && id!==lastRegisteredNote) { handleInput(id, ac, false); lastRegisteredNote=id; } } requestAnimationFrame(updatePitch); }
function autoCorrelate(buf, sr) { let rms=0; for(let i=0;i<buf.length;i++) rms+=buf[i]*buf[i]; if(Math.sqrt(rms/buf.length)<MIN_VOLUME_THRESHOLD) return -1; let r1=0,r2=buf.length-1,t=0.2; while(Math.abs(buf[r1])<t && r1<buf.length/2) r1++; while(Math.abs(buf[r2])<t && r2>buf.length/2) r2--; buf=buf.slice(r1,r2); const c=new Array(buf.length).fill(0); for(let i=0;i<buf.length;i++) for(let j=0;j<buf.length-i;j++) c[i]+=buf[j]*buf[j+i]; let d=0; while(c[d]>c[d+1]) d++; let maxv=-1, maxp=-1; for(let i=d;i<buf.length;i++) if(c[i]>maxv) { maxv=c[i]; maxp=i; } return sr/maxp; }
function noteFromPitch(f) { return Math.round(12*(Math.log(f/440)/Math.log(2)))+69; }
function log(message) { const time = new Date().toLocaleTimeString(); const entry = document.createElement('div'); entry.className = 'log-entry'; entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`; logContainer.appendChild(entry); logContainer.scrollTop = logContainer.scrollHeight; }

/* Version: #33 */
