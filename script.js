/* Version: #4 */

// === KONFIGURASJON ===
const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_VOLUME_THRESHOLD = 0.01; // Hvor høyt man må spille for at det skal registreres (støy-filter)

// === GLOBALE VARIABLER ===
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let isListening = false;
let rafID = null; // Request Animation Frame ID
let buflen = 2048;
let buf = new Float32Array(buflen);

// === DOM ELEMENTER ===
const btnStartMic = document.getElementById('btn-start-mic');
const displayStatus = document.getElementById('status-display');
const displayNote = document.getElementById('note-display');
const logContainer = document.getElementById('app-log');
const pianoKeys = document.querySelectorAll('.key');

// === LOGGING FUNKSJON ===
function log(message) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    logContainer.appendChild(entry);
    // Auto-scroll til bunnen
    logContainer.scrollTop = logContainer.scrollHeight;
    console.log(`[PianoLog] ${message}`);
}

// === EVENT LISTENERS ===
btnStartMic.addEventListener('click', toggleMicrophone);

// === MIKROFON HÅNDTERING ===
function toggleMicrophone() {
    if (isListening) {
        // Stopp lytting (enkelt oppsett: bare reload siden eller stopp prosessen visuelt for nå)
        // I en mer avansert versjon ville vi koblet fra noder.
        log("Stanser lytting (reload siden for å nullstille helt).");
        isListening = false;
        btnStartMic.innerText = "Start Mikrofon / Lyd";
        cancelAnimationFrame(rafID);
        displayStatus.innerText = "Status: Pauset";
        clearActiveKeys();
    } else {
        startPitchDetect();
    }
}

function startPitchDetect() {
    // Opprett AudioContext (støtte for flere nettlesere)
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Be om tilgang til mikrofon
    navigator.mediaDevices.getUserMedia({
        "audio": {
            "echoCancellation": true,
            "autoGainControl": false,
            "noiseSuppression": false
        }
    }).then((stream) => {
        // Oppsett vellykket
        isListening = true;
        btnStartMic.innerText = "Stopp Mikrofon";
        displayStatus.innerText = "Status: Lyttet...";
        log("Mikrofon tilgang gitt. AudioContext startet.");

        // Koble strømmen til analyseren
        mediaStreamSource = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        mediaStreamSource.connect(analyser);

        // Start loopen
        updatePitch();
    }).catch((err) => {
        // Feil ved tilgang
        log("FEIL: Kunne ikke få tilgang til mikrofon. " + err);
        displayStatus.innerText = "Status: Feil (Se logg)";
        console.error(err);
    });
}

// === HOVEDLOOP (Pitch Detection) ===
function updatePitch() {
    if (!isListening) return;

    // Fyll bufferen med data fra mikrofonen
    analyser.getFloatTimeDomainData(buf);

    // Beregn frekvens (Hz) ved hjelp av Auto-korrelasjon
    const ac = autoCorrelate(buf, audioContext.sampleRate);

    // Sjekk om vi fant en tone
    if (ac === -1) {
        // Ingen tydelig tone funnet (eller for lavt volum)
        // Vi gjør ingenting med displayet, beholder kanskje siste note et øyeblikk, 
        // eller fjerner markeringen umiddelbart. Her fjerner vi den for responsivitet.
        // Men for å unngå blinking kan man legge inn en forsinkelse her senere.
        // For nå: clearActiveKeys() hvis det er helt stille over tid? 
        // Vi lar den stå inntil videre, eller clearer hver frame hvis vi vil ha 'instant' feedback.
        // La oss cleare hvis volumet er null.
        // (Logikken ligger i autoCorrelate: returnerer -1 hvis lavt volum)
        // Vi clearer visuelt hvis ingen tone detekteres for å vise at man sluttet å spille.
        
        // For å unngå ekstrem blinking kan vi sjekke om det har gått litt tid, 
        // men la oss prøve direkte respons først.
    } else {
        // Vi har en frekvens!
        const note = noteFromPitch(ac);
        const noteName = NOTE_STRINGS[note % 12];
        const octave = Math.floor(note / 12) - 1;
        
        // Bygg ID-strengen som matcher HTML (f.eks. "C4", "F#4")
        const noteId = noteName + octave;
        
        // Oppdater tekst
        displayNote.innerText = `Note: ${noteId} (${Math.round(ac)} Hz)`;
        
        // Oppdater Piano Visuals
        highlightKey(noteId);
    }

    rafID = window.requestAnimationFrame(updatePitch);
}

// === MATEMATIKK (Auto-korrelasjon) ===
function autoCorrelate(buf, sampleRate) {
    // 1. Beregn RMS (Root Mean Square) for å sjekke volum
    let size = buf.length;
    let rms = 0;
    for (let i = 0; i < size; i++) {
        const val = buf[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / size);

    // Hvis lyden er for svak, ignorer (støy)
    if (rms < MIN_VOLUME_THRESHOLD) {
        return -1;
    }

    // 2. Auto-korrelasjon algoritme
    // Vi trimmer kantene av bufferet for bedre presisjon
    let r1 = 0, r2 = size - 1, thres = 0.2;
    for (let i = 0; i < size / 2; i++) {
        if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < size / 2; i++) {
        if (Math.abs(buf[size - i]) < thres) { r2 = size - i; break; }
    }

    buf = buf.slice(r1, r2);
    size = buf.length;

    const c = new Array(size).fill(0);
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size - i; j++) {
            c[i] = c[i] + buf[j] * buf[j + i];
        }
    }

    let d = 0;
    // Finn første dropp
    while (c[d] > c[d + 1]) d++;
    
    let maxval = -1, maxpos = -1;
    for (let i = d; i < size; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }
    
    let T0 = maxpos;

    // Interpolering for mer nøyaktighet
    const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    return sampleRate / T0;
}

// === HJELPEFUNKSJONER FOR NOTER ===
function noteFromPitch(frequency) {
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    return Math.round(noteNum) + 69;
}

// === UI OPPDATERING ===
let currentActiveKey = null;

function clearActiveKeys() {
    if (currentActiveKey) {
        currentActiveKey.classList.remove('active');
        currentActiveKey = null;
    }
    // Sikkerhetsnett: fjern fra alle
    pianoKeys.forEach(key => key.classList.remove('active'));
}

function highlightKey(noteId) {
    // Sjekk om vi allerede viser denne noten
    if (currentActiveKey && currentActiveKey.id === `key-${noteId}`) {
        return; // Ingen endring nødvendig
    }

    // Fjern gammel markering
    clearActiveKeys();

    // Finn ny tangent
    // Merk: HTML-IDene er formatert som "key-C4", "key-C#4" osv.
    // noteId kommer inn som "C4", "C#4".
    const keyElement = document.getElementById(`key-${noteId}`);

    if (keyElement) {
        keyElement.classList.add('active');
        currentActiveKey = keyElement;
        // log(`Detekterte note: ${noteId}`); // Kan spamme loggen mye, kommentert ut for nå.
    } else {
        // Noten er utenfor pianoets rekkevidde (vi har bare C4-C5 foreløpig)
        // Vi kan logge det en gang i blant hvis vi vil, men ignorerer for nå.
    }
}

// === INIT ===
log("Applikasjon lastet. Klar til å starte mikrofon.");

/* Version: #4 */
