import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Settings, 
  AlignLeft, 
  Scissors, 
  Clock, 
  Copy, 
  RotateCcw, 
  FileText, 
  Check, 
  Minimize,
  Type, 
  Video, 
  Sparkles, 
  Loader2, 
  Wand2, 
  Film, 
  RefreshCw, 
  ListOrdered, 
  Layers, 
  Eye, 
  EyeOff, 
  Zap, 
  Clapperboard, 
  History, 
  Globe, 
  AlertCircle, 
  Download, 
  MoreHorizontal, 
  Hash, 
  ArrowRight, 
  Palette, 
  Pause, 
  Play, 
  XCircle,
  Users,
  Plus,
  Trash2
} from 'lucide-react';

// --- Constantes y Configuración ---
const apiKey = ""; // La clave se inyecta en el entorno de ejecución
const SCENE_DURATION_STD = 5; // Duración estándar (Fase Normal)
const SCENE_DURATION_INTRO = 5; // Umbral para cortar en intro (Fase Dopamina)

const MODES = {
  sentences: { 
    label: "Por Cantidad de Frases", 
    desc: "Agrupa un número fijo de oraciones por párrafo.",
    unit: "frases"
  },
  smart_words: { 
    label: "Fluido (Inteligente)", 
    desc: "Agrupa frases completas hasta límite de palabras. Ideal para locución.",
    unit: "palabras aprox."
  },
  strict_words: { 
    label: "Estricto (Palabras)", 
    desc: "Corta exactamente al número de palabras.",
    unit: "palabras"
  },
  characters: { 
    label: "Teleprompter (Caracteres)", 
    desc: "Limita el ancho visual por caracteres.",
    unit: "caracteres"
  }
};

const VIDEO_STYLES = {
  hb: {
    label: "Estilo Guerra Brutal",
    value: "drawn animation characters in period-accurate attire, in the style of greg tocchini, with a warm earthy color palette and clean line art. (yellows, oranges, browns, reds), no text, no letters, no frame, only one scene"
  },
  unreal: {
    label: "Unreal Engine 5",
    value: "Unreal Engine 5 Octane Render, raytraced masterpiece, volumetric lighting, photorealistic digital art, no text, no letters, no frame, only one scene"
  },
  graphic_novel: {
    label: "Novela Gráfica",
    value: "visual style historical graphic novel illustration, technique digital art with traditional comic finish, european bande dessinée style, textured digital painting comic, visible, organic, semi-realistic with stylization, line technique defined ink lines, details high level of detail in faces and clothing, with a warm earthy color palette and clean line art. (yellows, oranges, browns, reds), no text, no letters, no frame, only one scene"
  },
  epic_illustration: {
    label: "Ilustración Épica",
    value: "style hand-drawn illustration, Historical epic, Detailed character design, Strong outlines, Dynamic compositions, Expressive faces, Earthy color palette, Grim and determined mood, Textured clothing and beards, no text, no letters, no frame"
  }
};

// Helper para llamadas a API con Backoff Exponencial
const callGeminiAPI = async (payload) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

  for (let i = 0; i <= delays.length; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        if (response.status === 400 || response.status === 401 || response.status === 403) {
             throw new Error(`FATAL_API_ERROR: ${response.status}`);
        }
        if (i < delays.length) {
             await new Promise(resolve => setTimeout(resolve, delays[i]));
             continue;
        }
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
       if (error.message.includes('FATAL_API_ERROR')) throw error;
       if (i === delays.length) throw error;
       await new Promise(resolve => setTimeout(resolve, delays[i]));
    }
  }
};

const App = () => {
  // --- Estados Principales ---
  const [inputText, setInputText] = useState("");
  const [mode, setMode] = useState("smart_words");
  const [limit, setLimit] = useState(50);
  const [wpm, setWpm] = useState(127);
  const [processedBlocks, setProcessedBlocks] = useState([]);
  
  // --- Estados de UI ---
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [hiddenPrompts, setHiddenPrompts] = useState({}); 
  const [errorMessage, setErrorMessage] = useState(null);
  
  // --- Estados de IA y Video ---
  const [historicalContext, setHistoricalContext] = useState("");
  const [isAnalyzingContext, setIsAnalyzingContext] = useState(false);
  
  // Estado de Personajes
  const [characters, setCharacters] = useState([]);

  // Estado de Estilos
  const [videoStyle, setVideoStyle] = useState(VIDEO_STYLES.hb.value);
  const [selectedStyleMode, setSelectedStyleMode] = useState('hb');

  const [generatedPrompts, setGeneratedPrompts] = useState({}); 
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  
  // --- Estados de Control de Generación (Pausa/Cancelación) ---
  const [generationStatus, setGenerationStatus] = useState('idle'); // 'idle', 'generating', 'paused'
  const controlRef = useRef('idle'); // Ref mutable para controlar el bucle asíncrono

  // --- Configuración de Alcance (Scope) ---
  const [generationLimit, setGenerationLimit] = useState(0); // 0 = Todo, 'custom' = Rango
  const [intermediatePromptsCount, setIntermediatePromptsCount] = useState(0); 
  const [regeneratingId, setRegeneratingId] = useState(null); 

  // Estados para Rango Personalizado
  const [customStartBlock, setCustomStartBlock] = useState(1);
  const [customEndBlock, setCustomEndBlock] = useState(10);
  const [customPromptStart, setCustomPromptStart] = useState(1); // Número manual de inicio de prompt

  // --- Nueva Configuración: Intro Dinámica ---
  const [useDynamicIntro, setUseDynamicIntro] = useState(false);
  const [dynamicBlockCount, setDynamicBlockCount] = useState(5);

  // --- Lógica de Procesamiento de Texto ---
  const splitIntoSentences = (text) => {
    if (!text) return [];
    try {
      const segmenter = text.match(/[^.!?\n]+[.!?\n]+["']?|[^.!?\n]+$/g);
      return segmenter ? segmenter.map(s => s.trim()) : [text];
    } catch (e) {
      console.warn("Error splitting sentences", e);
      return [text];
    }
  };

  const processText = useCallback(() => {
    if (!inputText || !inputText.trim()) {
      setProcessedBlocks(prev => prev.length > 0 ? [] : prev);
      setGeneratedPrompts({});
      setHiddenPrompts({});
      setHistoricalContext("");
      setCharacters([]);
      setErrorMessage(null);
      return;
    }

    const cleanText = inputText.replace(/\s+/g, ' ').trim();
    let blocks = [];
    
    try {
        if (mode === 'sentences') {
          const sentences = splitIntoSentences(cleanText);
          let currentBlock = [];
          sentences.forEach((sentence, index) => {
            currentBlock.push(sentence);
            if (currentBlock.length >= limit || index === sentences.length - 1) {
              blocks.push(currentBlock.join(' '));
              currentBlock = [];
            }
          });
        } 
        else if (mode === 'strict_words') {
          const words = cleanText.split(' ');
          let currentBlock = [];
          words.forEach((word, index) => {
            currentBlock.push(word);
            if (currentBlock.length >= limit || index === words.length - 1) {
              blocks.push(currentBlock.join(' '));
              currentBlock = [];
            }
          });
        }
        else if (mode === 'smart_words') {
          const sentences = splitIntoSentences(cleanText);
          let currentBlock = [];
          let currentWordCount = 0;
          sentences.forEach((sentence, index) => {
            const sentenceWordCount = sentence.split(' ').length;
            if (currentWordCount + sentenceWordCount > limit && currentBlock.length > 0) {
              blocks.push(currentBlock.join(' '));
              currentBlock = [];
              currentWordCount = 0;
            }
            currentBlock.push(sentence);
            currentWordCount += sentenceWordCount;
            if (index === sentences.length - 1) {
              blocks.push(currentBlock.join(' '));
            }
          });
        }
        else if (mode === 'characters') {
          let currentBlock = "";
          const words = cleanText.split(' ');
          words.forEach((word, index) => {
            if ((currentBlock.length + word.length + 1) > limit && currentBlock.length > 0) {
              blocks.push(currentBlock.trim());
              currentBlock = "";
            }
            currentBlock += word + " ";
            if (index === words.length - 1) {
              blocks.push(currentBlock.trim());
            }
          });
        }
        
        setProcessedBlocks(blocks);
    } catch (error) {
        console.error("Error processing text:", error);
        setProcessedBlocks([cleanText]); 
    }
  }, [inputText, mode, limit]);

  useEffect(() => {
    processText();
  }, [processText]);

  // Actualizar el bloque final por defecto cuando cambian los bloques procesados
  useEffect(() => {
    if (processedBlocks.length > 0) {
      setCustomEndBlock(processedBlocks.length);
    }
  }, [processedBlocks.length]);

  // --- Gestión de Personajes ---
  const addCharacter = () => {
    setCharacters([...characters, { id: Date.now(), name: '', description: '' }]);
  };

  const removeCharacter = (id) => {
    setCharacters(characters.filter(c => c.id !== id));
  };

  const updateCharacter = (id, field, value) => {
    setCharacters(characters.map(c => 
      c.id === id ? { ...c, [field]: value } : c
    ));
  };

  // --- Manejadores de Estilo ---
  const handleStyleSelect = (e) => {
    const selectedKey = e.target.value;
    setSelectedStyleMode(selectedKey);
    
    if (selectedKey !== 'custom' && VIDEO_STYLES[selectedKey]) {
        setVideoStyle(VIDEO_STYLES[selectedKey].value);
    }
  };

  const handleManualStyleChange = (e) => {
    setVideoStyle(e.target.value);
    setSelectedStyleMode('custom');
  };

  // --- Utilidades ---
  const getDurationSeconds = (text) => {
    if (!text || typeof text !== 'string') return 0;
    const words = text.split(/\s+/).length;
    const minutes = words / wpm;
    return minutes * 60; 
  };
  
  const calculateDurationDisplay = (text) => {
    const seconds = Math.round(getDurationSeconds(text));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds/60)}m ${seconds % 60}s`;
  };

  const secureCopy = (text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try { document.execCommand('copy'); } catch (err) { console.error(err); }
    document.body.removeChild(textArea);
  };

  // Helper para contar prompts existentes ANTES de un bloque específico
  const countPromptsBeforeBlock = (blockIndex) => {
    let count = 0;
    for (let i = 0; i < blockIndex; i++) {
      if (generatedPrompts[i]) {
        count += generatedPrompts[i].length;
      }
    }
    return count;
  };

  // Calcula el número global consecutivo de un prompt específico
  const getGlobalPromptNumber = (currentBlockIdx, currentPromptIdx) => {
    const internalCount = countPromptsBeforeBlock(currentBlockIdx) + currentPromptIdx + 1;
    
    if (generationLimit === 'custom') {
        const startBlockIndex = Math.max(0, customStartBlock - 1);
        const realPromptsBeforeStart = countPromptsBeforeBlock(startBlockIndex);
        return customPromptStart + (internalCount - realPromptsBeforeStart - 1);
    }
    
    return internalCount;
  };

  const copyPrompt = (promptText, blockIdx, promptIdx) => {
    const number = getGlobalPromptNumber(blockIdx, promptIdx);
    const fullPrompt = `${number}. ${promptText}, ${videoStyle}`;
    const cleanPrompt = fullPrompt.replace(/[\r\n]+/g, " ");
    secureCopy(cleanPrompt);
    
    const promptId = `${blockIdx}-${promptIdx}`;
    setCopiedIndex(promptId);
    setHiddenPrompts(prev => ({ ...prev, [promptId]: true }));
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copyText = (text, index) => {
    secureCopy(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copyAllPrompts = () => {
    let allPromptsList = [];
    Object.keys(generatedPrompts).sort((a,b) => Number(a)-Number(b)).forEach(blockKey => {
        const idx = Number(blockKey);
        const prompts = generatedPrompts[idx];
        if (prompts && Array.isArray(prompts) && prompts.length > 0) {
            prompts.forEach((prompt, pIdx) => {
                const number = getGlobalPromptNumber(idx, pIdx);
                const fullPrompt = `${number}. ${prompt}, ${videoStyle}`;
                allPromptsList.push(fullPrompt.replace(/[\r\n]+/g, " "));
            });
        }
    });

    if (allPromptsList.length > 0) {
        const textToCopy = allPromptsList.join('\n');
        secureCopy(textToCopy);
        setCopiedIndex('all-prompts');
        setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const togglePromptVisibility = (blockIdx, promptIdx) => {
    const promptId = `${blockIdx}-${promptIdx}`;
    setHiddenPrompts(prev => {
        const newState = { ...prev };
        if (newState[promptId]) {
            delete newState[promptId];
        } else {
            newState[promptId] = true;
        }
        return newState;
    });
  };

  const downloadHTML = () => {
    const safeBlocks = JSON.stringify(processedBlocks).replace(/<\/script>/g, '<\\/script>');
    const safePrompts = JSON.stringify(generatedPrompts).replace(/<\/script>/g, '<\\/script>');
    const safeStyle = JSON.stringify(videoStyle).replace(/<\/script>/g, '<\\/script>');
    
    const safeIsCustom = generationLimit === 'custom';
    const safeCustomStartBlock = customStartBlock;
    const safeCustomPromptStart = customPromptStart;

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DioApp Veo3 - Guion Exportado</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #94a3b8; }
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="bg-slate-50 text-slate-800 p-4 md:p-8 min-h-screen">
    <div class="max-w-5xl mx-auto space-y-6">
        <header class="flex flex-col md:flex-row justify-between items-center border-b border-slate-200 pb-6 bg-white p-6 rounded-2xl shadow-sm">
            <div>
                <h1 class="text-3xl font-extrabold text-slate-800 flex items-center gap-2">
                    <span class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600">DioApp Veo3</span>
                    <span class="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-full font-medium border border-slate-200">Exportación Local</span>
                </h1>
                <p class="text-sm text-slate-400 mt-1 font-medium">Guion y Prompts Generados</p>
            </div>
            <div class="flex gap-2 mt-4 md:mt-0">
                <button onclick="copyAllPrompts()" class="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-md active:scale-95 flex items-center gap-2">
                    <i data-lucide="layers" class="w-4 h-4"></i> Copiar Todo
                </button>
            </div>
        </header>
        <div id="content" class="space-y-6 pb-20"></div>
    </div>
    <script>
        const processedBlocks = ${safeBlocks};
        const generatedPrompts = ${safePrompts};
        const videoStyle = ${safeStyle};
        const isCustom = ${safeIsCustom};
        const customStartBlock = ${safeCustomStartBlock};
        const customPromptStart = ${safeCustomPromptStart};
        const hiddenPrompts = {};

        function getDurationSeconds(text) {
            if (!text || typeof text !== 'string') return 0;
            return (text.split(/\\s+/).length / 127) * 60;
        }

        function secureCopy(text) {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try { document.execCommand('copy'); } catch (err) {}
            document.body.removeChild(textArea);
        }

        function countPromptsBeforeBlock(blockIndex) {
            let count = 0;
            for (let i = 0; i < blockIndex; i++) {
                if (generatedPrompts[i]) count += generatedPrompts[i].length;
            }
            return count;
        }

        function getGlobalPromptNumber(currentBlockIdx, currentPromptIdx) {
            const internalCount = countPromptsBeforeBlock(currentBlockIdx) + currentPromptIdx + 1;
            if (isCustom) {
                const startBlockIndex = Math.max(0, customStartBlock - 1);
                const realPromptsBeforeStart = countPromptsBeforeBlock(startBlockIndex);
                return customPromptStart + (internalCount - realPromptsBeforeStart - 1);
            }
            return internalCount;
        }

        function render() {
            const container = document.getElementById('content');
            let html = '';
            processedBlocks.forEach((block, idx) => {
                const prompts = generatedPrompts[idx] || [];
                const durationSecs = getDurationSeconds(block);
                let promptsHtml = '';
                
                if (prompts && prompts.length > 0) {
                    promptsHtml = \`<div class="bg-white p-5 space-y-4 relative border-t border-slate-100"><div class="space-y-3">\`;
                    prompts.forEach((promptText, pIdx) => {
                        const promptId = idx + '-' + pIdx;
                        const isHidden = hiddenPrompts[promptId];
                        const globalNum = getGlobalPromptNumber(idx, pIdx);
                        if (isHidden) {
                            promptsHtml += \`<div class="bg-emerald-50/50 border border-emerald-100 rounded-xl p-3 flex items-center justify-between opacity-80 backdrop-blur-sm"><div class="flex items-center gap-3"><span class="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-md">#\${globalNum}</span><span class="text-xs font-bold text-emerald-600 flex items-center gap-1"><i data-lucide="check" class="w-3 h-3"></i> Copiado</span></div><button onclick="toggleHide('\${promptId}')"><i data-lucide="rotate-ccw" class="w-4 h-4 text-slate-400"></i></button></div>\`;
                        } else {
                            promptsHtml += \`<div class="bg-slate-50/50 border border-slate-200/60 rounded-xl p-4 relative shadow-sm"><div class="flex gap-3 mb-3 border-b border-slate-100 pb-2"><div class="text-white text-xs font-bold px-2 py-1 rounded-lg bg-indigo-600">#\${globalNum}</div></div><p class="text-sm text-slate-600 mb-4">\${promptText}</p><div class="flex justify-end gap-2"><button onclick="copyPrompt(\${idx}, \${pIdx})" class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex gap-1"><i data-lucide="copy" class="w-3 h-3"></i> Copiar</button></div></div>\`;
                        }
                    });
                    promptsHtml += '</div></div>';
                }
                html += \`<div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6"><div class="p-6 relative bg-gradient-to-r from-slate-50 to-white"><div class="flex justify-between mb-4"><span class="text-[10px] font-bold uppercase bg-slate-100 px-2 py-1 rounded">BLOQUE \${idx + 1}</span><span class="text-xs font-bold">\${Math.round(durationSecs * 10) / 10}s</span></div><p class="text-lg text-slate-700 font-serif">\${block}</p></div>\${promptsHtml}</div>\`;
            });
            container.innerHTML = html;
            if (window.lucide) lucide.createIcons();
        }

        function copyPrompt(blockIdx, promptIdx) {
            const num = getGlobalPromptNumber(blockIdx, promptIdx);
            const text = generatedPrompts[blockIdx][promptIdx];
            secureCopy(num + ". " + text + ", " + videoStyle);
            hiddenPrompts[blockIdx + '-' + promptIdx] = true;
            render();
        }

        function toggleHide(id) {
            if (hiddenPrompts[id]) delete hiddenPrompts[id];
            else hiddenPrompts[id] = true;
            render();
        }

        function copyAllPrompts() {
             let allText = [];
             Object.keys(generatedPrompts).sort((a,b) => Number(a)-Number(b)).forEach(blockKey => {
                const idx = Number(blockKey);
                generatedPrompts[idx].forEach((p, pIdx) => {
                    const num = getGlobalPromptNumber(idx, pIdx);
                    allText.push((num + ". " + p + ", " + videoStyle).replace(/[\\r\\n]+/g, " "));
                });
             });
             if (allText.length > 0) secureCopy(allText.join('\\n'));
        }

        render();
    </script>
</body>
</html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dioapp-veo3-guion.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- API Calls ---
  
  const analyzeHistoricalContext = async () => {
      if (!inputText.trim()) return;
      setIsAnalyzingContext(true);
      setErrorMessage(null);
      try {
          const systemInstruction = `Eres un historiador experto. Analiza la siguiente narración e identifica el contexto histórico, cultural y geográfico. Responde ÚNICAMENTE con una breve frase o lista de palabras clave que describan esta ambientación. Ejemplo: 'Antigua Roma, época imperial, legiones y senadores'. Ejemplo 2: 'Japón feudal, samuráis, período Edo'. Tu respuesta se usará como guía para generar cada uno de los prompt de video para respetar ropa, arquitectura, ambiente etc`;
          
          const payload = {
              contents: [{ parts: [{ text: inputText.substring(0, 10000) }] }], // Analizamos el texto (hasta un limite razonable)
              systemInstruction: { parts: [{ text: systemInstruction }] }
          };

          const data = await callGeminiAPI(payload);
          const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
          
          if (result) {
              setHistoricalContext(result.trim());
          }
      } catch (error) {
          console.error("Error analyzing context:", error);
          if (error.message.includes('FATAL_API_ERROR')) {
               setErrorMessage("Error de Autenticación (401). Verifica tu API Key.");
          }
      }
      setIsAnalyzingContext(false);
  };

  // --- CONTROLES DE GENERACIÓN ---
  const handlePauseGeneration = () => {
      controlRef.current = 'paused';
      setGenerationStatus('paused');
  };

  const handleResumeGeneration = () => {
      controlRef.current = 'generating';
      setGenerationStatus('generating');
  };

  const handleCancelGeneration = () => {
      controlRef.current = 'cancelled';
      // El estado se actualizará a 'idle' cuando el bucle detecte la cancelación
  };

  const generatePromptsWithAI = async () => {
    if (processedBlocks.length === 0) return;
    
    setIsGenerating(true);
    setGenerationStatus('generating');
    controlRef.current = 'generating'; // Iniciar en estado activo

    setGenerationProgress(0);
    setHiddenPrompts({}); 
    setErrorMessage(null);
    
    const newPrompts = { ...generatedPrompts };

    // Definir índices de inicio y fin según la configuración de Alcance
    let startIdx = 0;
    let endIdx = processedBlocks.length;

    if (generationLimit === 'custom') {
        startIdx = Math.max(0, customStartBlock - 1);
        endIdx = Math.min(processedBlocks.length, customEndBlock);
    } else if (generationLimit > 0) {
        endIdx = Math.min(processedBlocks.length, generationLimit);
    }

    let totalOperations = endIdx - startIdx;
    
    if (generationLimit > 0 && generationLimit !== 'custom' && intermediatePromptsCount > 0 && processedBlocks.length > generationLimit) {
        totalOperations += intermediatePromptsCount;
    }
    
    // --- Preparar Contexto de Personajes ---
    const characterContext = characters
        .filter(c => c.name.trim() && c.description.trim())
        .map(c => `NAME: "${c.name}" -> APPEARANCE: "${c.description}"`)
        .join('; ');

    let processedCount = 0;
    let timeBuffer = 0;
    let textBuffer = "";

    // BUCLE PRINCIPAL
    for (let i = startIdx; i < endIdx; i++) {
        // --- CONTROL DE PAUSA / CANCELACIÓN ---
        while (controlRef.current === 'paused') {
            await new Promise(resolve => setTimeout(resolve, 200)); // Esperar activamente
            if (controlRef.current === 'cancelled') break;
        }
        
        if (controlRef.current === 'cancelled') {
            setIsGenerating(false);
            setGenerationStatus('idle');
            setErrorMessage("Generación cancelada por el usuario.");
            return;
        }
        // --------------------------------------

        const blockText = processedBlocks[i];
        const nextBlockText = processedBlocks[i+1] || "";
        const blockDuration = getDurationSeconds(blockText);
        
        // --- 1. MODO INTRO DINÁMICA ---
        if (useDynamicIntro && i < dynamicBlockCount) {
             timeBuffer = 0;
             textBuffer = "";
             const numScenes = Math.max(1, Math.ceil(blockDuration / SCENE_DURATION_INTRO));

             try {
                const systemInstruction = `
                    You are an Expert AI Visual Director optimizing for HIGH RETENTION (Dopamine hit).
                    OBJECTIVE: Create ${numScenes}, distinct visual prompts for this specific script segment.
                    SETTING/CONTEXT: "${historicalContext}". STRICTLY apply this historical/cultural context to ALL visual elements.
                    
                    DEFINED CHARACTERS (STRICT ADHERENCE REQUIRED):
                    ${characterContext || "No specific characters defined."}
                    
                    CRITICAL FORMATTING RULE: 
                    If ONE OR MORE defined characters appear in the scene, you MUST place the exact physical description inside parentheses immediately after EACH of their names.
                    Example: "Julio Cesar (man of 52 years...) talks to Marco Antonio (man of 40 years, broad shoulders...)"
                    Do this for EVERY defined character that appears in the scene.

                    RULES:
                    1. Focus on ACTION.
                    2. Maintain character consistency using the provided descriptions.
                    3. No style keywords.
                    4. ALWAYS OUTPUT PROMPTS IN ENGLISH.
                    5. Output: JSON Array of Strings.
                `;

                const userPrompt = `
                    SCRIPT SEGMENT (Approx ${Math.round(blockDuration)}s): """${blockText}"""
                    NEXT CONTEXT: """${nextBlockText.substring(0, 50)}..."""
                    Generate ${numScenes} visual prompt(s).
                `;

                const payload = {
                    contents: [{ parts: [{ text: userPrompt }] }],
                    systemInstruction: { parts: [{ text: systemInstruction }] },
                    generationConfig: { responseMimeType: "application/json" }
                };

                const data = await callGeminiAPI(payload);
                const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
                
                if (textResponse) {
                    let parsed = JSON.parse(textResponse);
                    if (Array.isArray(parsed)) {
                        parsed = parsed.map(p => typeof p === 'string' ? p : JSON.stringify(p));
                        newPrompts[i] = parsed;
                    }
                }
             } catch (error) {
                console.error("Block Intro " + i, error);
                if (error.message && (error.message.includes('FATAL_API_ERROR') || error.message.includes('401'))) {
                    setErrorMessage("Error Crítico: Fallo de Autenticación. El proceso se ha detenido.");
                    setIsGenerating(false);
                    setGenerationStatus('idle');
                    return;
                }
                newPrompts[i] = [`Dynamic Scene: ${blockText}`];
             }

        // --- 2. MODO ESTÁNDAR ---
        } else {
            timeBuffer += blockDuration;
            textBuffer += blockText + " ";
            const numScenes = Math.floor(timeBuffer / SCENE_DURATION_STD);
            
            if (numScenes > 0) {
                try {
                    const systemInstruction = `
                        You are an Expert AI Visual Director for video generation.
                        Create consistent, descriptive visual prompts.
                        COVERAGE: Create ${numScenes} scene(s) representing the accumulated content.
                        SETTING/CONTEXT: "${historicalContext}". STRICTLY apply this historical/cultural context.
                        
                        DEFINED CHARACTERS (STRICT ADHERENCE REQUIRED):
                        ${characterContext || "No specific characters defined."}
                        
                        CRITICAL FORMATTING RULE: 
                        If ONE OR MORE defined characters appear in the scene, you MUST place the exact physical description inside parentheses immediately after EACH of their names.
                        Example: "Julio Cesar (man of 52 years...) talks to Marco Antonio (man of 40 years, broad shoulders...)"
                        Do this for EVERY defined character that appears in the scene.

                        RULES:
                        1. ALWAYS OUTPUT PROMPTS IN ENGLISH.
                        2. Output: JSON Array of Strings.
                    `;

                    const userPrompt = `
                        CONTENT (Approx ${numScenes * SCENE_DURATION_STD}s): """${textBuffer.trim()}"""
                        NEXT CONTEXT: """${nextBlockText.substring(0, 50)}..."""
                        Generate ${numScenes} distinct visual prompt(s) (${SCENE_DURATION_STD}s each).
                    `;

                    const payload = {
                        contents: [{ parts: [{ text: userPrompt }] }],
                        systemInstruction: { parts: [{ text: systemInstruction }] },
                        generationConfig: { responseMimeType: "application/json" }
                    };

                    const data = await callGeminiAPI(payload);
                    const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    
                    if (textResponse) {
                        let parsed = JSON.parse(textResponse);
                        if (Array.isArray(parsed)) {
                            parsed = parsed.map(p => typeof p === 'string' ? p : JSON.stringify(p));
                            newPrompts[i] = parsed;
                        }
                    }

                    timeBuffer = timeBuffer % SCENE_DURATION_STD;
                    textBuffer = ""; 

                } catch (error) {
                    console.error("Block Std " + i, error);
                    if (error.message && (error.message.includes('FATAL_API_ERROR') || error.message.includes('401'))) {
                        setErrorMessage("Error Crítico: Fallo de Autenticación. El proceso se ha detenido.");
                        setIsGenerating(false);
                        setGenerationStatus('idle');
                        return;
                    }
                    newPrompts[i] = [`Scene: ${blockText}`];
                }
            } else {
                newPrompts[i] = []; 
            }
        }

        processedCount++;
        setGeneratedPrompts({ ...newPrompts });
        setGenerationProgress((processedCount / totalOperations) * 100);
    }

    // --- FASE 2: PROMPTS INTERMEDIOS ---
    if (generationLimit > 0 && generationLimit !== 'custom' && intermediatePromptsCount > 0) {
        const remainingBlocks = processedBlocks.length - endIdx;
        
        if (remainingBlocks > 0) {
            const step = Math.max(1, Math.floor(remainingBlocks / intermediatePromptsCount));
            
            for (let j = 1; j <= intermediatePromptsCount; j++) {
                // --- CONTROL DE PAUSA / CANCELACIÓN EN FASE 2 ---
                while (controlRef.current === 'paused') {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    if (controlRef.current === 'cancelled') break;
                }
                if (controlRef.current === 'cancelled') {
                    setIsGenerating(false);
                    setGenerationStatus('idle');
                    setErrorMessage("Generación cancelada por el usuario.");
                    return;
                }
                // ------------------------------------------------

                let targetIdx = endIdx + (j * step) - 1;
                if (targetIdx >= processedBlocks.length) {
                    targetIdx = processedBlocks.length - 1;
                    if (newPrompts[targetIdx]) break; 
                }

                const blockText = processedBlocks[targetIdx];
                
                try {
                    const systemInstruction = `
                        You are an Expert AI Visual Director.
                        OBJECTIVE: Create ONE concise visual prompt.
                        CONTEXT: Intermediate scene.
                        SETTING/CONTEXT: "${historicalContext}".
                        
                        DEFINED CHARACTERS:
                        ${characterContext || "None."}
                        
                        CRITICAL FORMATTING RULE: 
                        If ONE OR MORE defined characters appear, place their exact description in parentheses immediately after EACH of their names.

                        RULES: 1. ENGLISH. 2. Output: JSON Array (1 string).
                    `;

                    const userPrompt = `SCRIPT BLOCK: """${blockText}""" Generate 1 visual prompt.`;

                    const payload = {
                        contents: [{ parts: [{ text: userPrompt }] }],
                        systemInstruction: { parts: [{ text: systemInstruction }] },
                        generationConfig: { responseMimeType: "application/json" }
                    };

                    const data = await callGeminiAPI(payload);
                    const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    
                    if (textResponse) {
                        let parsed = JSON.parse(textResponse);
                        if (Array.isArray(parsed)) {
                            parsed = parsed.map(p => typeof p === 'string' ? p : JSON.stringify(p));
                            newPrompts[targetIdx] = parsed; 
                        }
                    }
                } catch (error) {
                    console.error("Block Intermediate " + targetIdx, error);
                    newPrompts[targetIdx] = [`Scene (Intermediate): ${blockText.substring(0, 50)}...`];
                }

                processedCount++;
                setGeneratedPrompts({ ...newPrompts });
                setGenerationProgress((processedCount / totalOperations) * 100);
            }
        }
    }
    
    setIsGenerating(false);
    setGenerationStatus('idle');
  };

  const regenerateSinglePrompt = async (blockIdx, promptIdx, currentPrompt) => {
    const promptId = `${blockIdx}-${promptIdx}`;
    setRegeneratingId(promptId);
    setErrorMessage(null);

    // Contexto personajes
    const characterContext = characters
        .filter(c => c.name.trim() && c.description.trim())
        .map(c => `NAME: "${c.name}" -> APPEARANCE: "${c.description}"`)
        .join('; ');

    try {
        const systemInstruction = `
            Rewrite the prompt to be visually consistent. Ensure Safe for Work. ALWAYS OUTPUT IN ENGLISH. 
            CONSTRAINT: No voices/dialogue, only ambient sounds. 
            SETTING/CONTEXT: "${historicalContext}" (Apply strict historical accuracy).
            
            DEFINED CHARACTERS:
            ${characterContext || "None."}
            
            CRITICAL FORMATTING RULE: 
            If the prompt mentions ONE OR MORE defined characters, ensure EACH name is followed immediately by their exact physical description in parentheses.
            
            Return raw string.
        `;
        const userPrompt = `ORIGINAL: "${currentPrompt}". Improve clarity and visual description.`;

        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] }
        };

        const data = await callGeminiAPI(payload);
        const newText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (newText) {
            const updated = { ...generatedPrompts };
            updated[blockIdx][promptIdx] = newText.trim();
            setGeneratedPrompts(updated);
        }
    } catch (error) { 
        console.error(error); 
        if (error.message && (error.message.includes('FATAL_API_ERROR') || error.message.includes('401'))) {
             setErrorMessage("Error al regenerar: Fallo de API Key.");
        }
    }
    setRegeneratingId(null);
  };

  // --- Render ---
  let globalPromptCounter = 1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/50 text-slate-800 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header Rebranded */}
        <header className="flex flex-col md:flex-row md:items-center justify-between pb-8 pt-4 border-b border-slate-200/60">
          <div>
            <h1 className="text-4xl font-extrabold flex items-center gap-3 tracking-tight">
              <div className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white p-2.5 rounded-2xl shadow-lg shadow-indigo-500/20">
                 <Film size={28} strokeWidth={2} />
              </div>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-slate-800 via-indigo-900 to-slate-900">
                DioApp <span className="text-indigo-600">Veo3</span>
              </span>
            </h1>
            <p className="text-slate-500 mt-2 font-medium ml-1 flex items-center gap-2 text-sm">
                <Sparkles size={14} className="text-indigo-400" />
                Suite de Dirección Visual Inteligente
            </p>
          </div>
          <div className="mt-6 md:mt-0 flex gap-3">
             <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm transition-shadow hover:shadow-md">
                <div className="bg-indigo-50 p-1.5 rounded-lg text-indigo-600">
                    <Clock size={18} />
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Velocidad</span>
                    <div className="flex items-baseline gap-1">
                        <input 
                          type="number" 
                          value={wpm} 
                          onChange={(e) => setWpm(Number(e.target.value))}
                          className="w-10 text-sm font-bold text-slate-700 bg-transparent focus:outline-none border-b border-transparent focus:border-indigo-500 p-0"
                        />
                        <span className="text-xs text-slate-400 font-medium">WPM</span>
                    </div>
                </div>
             </div>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Panel Izquierdo */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Configuración */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 space-y-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Settings size={16} /> Configuración de Segmentación
              </h2>
              
              <div className="grid grid-cols-2 gap-3">
                  {Object.entries(MODES).map(([key, config]) => (
                    <button
                      key={key}
                      onClick={() => setMode(key)}
                      className={`text-left px-4 py-3 rounded-xl border transition-all duration-200 text-xs relative overflow-hidden group ${
                        mode === key 
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-900 shadow-inner' 
                          : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'
                      }`}
                    >
                      {mode === key && <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500" />}
                      <span className={`font-bold block mb-1 text-sm ${mode === key ? 'text-indigo-700' : 'text-slate-700'}`}>{config.label}</span>
                      <span className="opacity-70 leading-relaxed block">{config.desc}</span>
                    </button>
                  ))}
              </div>

              <div className="pt-2">
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider flex justify-between mb-3">
                  <span>Límite ({MODES[mode].unit})</span>
                  <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">{limit}</span>
                </label>
                <input 
                  type="range" 
                  min={mode === 'sentences' ? 1 : mode === 'characters' ? 20 : 10}
                  max={mode === 'sentences' ? 10 : mode === 'characters' ? 200 : 300}
                  step={1}
                  value={limit} 
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-500 transition-all"
                />
              </div>
            </section>

            {/* Generador AI */}
            <section className="bg-[#1e1b4b] rounded-2xl shadow-xl shadow-indigo-900/20 border border-indigo-900/50 p-6 text-white space-y-5 relative overflow-hidden group">
                {/* Decoration */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/20 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-violet-600/20 rounded-full blur-3xl -ml-10 -mb-10 pointer-events-none"></div>

                <div className="flex items-center justify-between relative z-10">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-500/20 rounded-lg border border-indigo-400/30">
                           <Video size={18} className="text-indigo-300" /> 
                        </div>
                        Director AI
                    </h2>
                    <div className="bg-indigo-900/50 px-2 py-1 rounded text-[10px] font-mono text-indigo-300 border border-indigo-500/30">
                        Gemini 2.5 Flash
                    </div>
                </div>

                 {/* ANÁLISIS DE CONTEXTO HISTÓRICO */}
                 <div className="relative z-10 bg-indigo-950/40 p-3 rounded-xl border border-indigo-500/20 flex flex-col gap-2">
                      <label className="text-xs font-bold uppercase text-indigo-300/80 tracking-wider flex items-center gap-1">
                        <Globe size={12} /> Contexto Histórico/Cultural
                      </label>
                      <div className="flex gap-2">
                        <textarea 
                            value={historicalContext}
                            onChange={(e) => setHistoricalContext(e.target.value)}
                            className="w-full bg-indigo-900/50 border border-indigo-500/30 rounded-lg p-2 text-xs text-indigo-100 placeholder-indigo-400/30 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none h-16 leading-relaxed"
                            placeholder="Ej: Antigua Roma, Legiones, Siglo I..."
                        />
                        <button 
                             onClick={analyzeHistoricalContext}
                             disabled={isAnalyzingContext || !inputText}
                             className={`px-3 rounded-lg border flex flex-col items-center justify-center gap-1 transition-all ${
                                 isAnalyzingContext || !inputText
                                 ? 'bg-indigo-900/30 border-indigo-800 text-indigo-500 cursor-not-allowed'
                                 : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500 text-white shadow-sm'
                             }`}
                             title="Analizar contexto del guion"
                          >
                             {isAnalyzingContext ? <Loader2 size={16} className="animate-spin" /> : <History size={16} />}
                             <span className="text-[10px] font-bold">Analizar</span>
                        </button>
                      </div>
                 </div>

                {/* --- SECCIÓN PERSONAJES (NUEVA) --- */}
                <div className="relative z-10 bg-indigo-950/40 p-3 rounded-xl border border-indigo-500/20 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                         <label className="text-xs font-bold uppercase text-indigo-300/80 tracking-wider flex items-center gap-1">
                            <Users size={12} /> Personajes & Apariencia
                         </label>
                         <button 
                            onClick={addCharacter}
                            className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded flex items-center gap-1 transition-colors"
                         >
                            <Plus size={10} /> Añadir
                         </button>
                      </div>
                      
                      <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                          {characters.length === 0 && (
                              <div className="text-[10px] text-indigo-400/50 text-center py-2 italic border border-dashed border-indigo-500/20 rounded-lg">
                                  Sin personajes definidos.
                              </div>
                          )}
                          {characters.map((char) => (
                              <div key={char.id} className="bg-indigo-900/30 border border-indigo-500/20 rounded-lg p-2 flex flex-col gap-2 group">
                                  <div className="flex gap-2">
                                      <input 
                                          type="text" 
                                          placeholder="Nombre (ej: Julio César)"
                                          value={char.name}
                                          onChange={(e) => updateCharacter(char.id, 'name', e.target.value)}
                                          className="flex-1 bg-indigo-950/50 border border-indigo-500/30 rounded px-2 py-1 text-xs text-indigo-100 focus:outline-none focus:border-indigo-400 placeholder-indigo-400/30"
                                      />
                                      <button 
                                          onClick={() => removeCharacter(char.id)}
                                          className="text-indigo-400 hover:text-red-400 p-1"
                                      >
                                          <Trash2 size={12} />
                                      </button>
                                  </div>
                                  <textarea 
                                      placeholder="Descripción física detallada (ej: 50 años, pelo corto gris, toga blanca, cicatriz en mejilla...)"
                                      value={char.description}
                                      onChange={(e) => updateCharacter(char.id, 'description', e.target.value)}
                                      className="w-full bg-indigo-950/50 border border-indigo-500/30 rounded px-2 py-1 text-[10px] text-indigo-200 focus:outline-none focus:border-indigo-400 placeholder-indigo-400/30 resize-none h-12 leading-tight"
                                  />
                              </div>
                          ))}
                      </div>
                      <p className="text-[9px] text-indigo-400 italic">
                         * Si la IA detecta el nombre, inyectará la descripción en el prompt generado.
                      </p>
                </div>
                
                <div className="space-y-2 relative z-10">
                    <div className="flex items-center justify-between">
                          <label className="text-xs font-bold uppercase text-indigo-300/80 tracking-wider flex items-center gap-1">
                             <Palette size={12} /> Estilo Visual
                          </label>
                          <select 
                            value={selectedStyleMode}
                            onChange={handleStyleSelect}
                            className="bg-indigo-900/80 border border-indigo-500/40 text-indigo-100 text-[10px] rounded-lg px-2 py-1 focus:outline-none hover:bg-indigo-800 transition-colors cursor-pointer max-w-[150px]"
                          >
                             <option value="hb">Estilo Guerra Brutal</option>
                             <option value="unreal">Unreal Engine 5</option>
                             <option value="graphic_novel">Estilo Historia Brutal</option>
                             <option value="epic_illustration">Ilustración Épica</option>
                             <option value="custom">Personalizado</option>
                          </select>
                    </div>
                    
                    <textarea 
                        value={videoStyle}
                        onChange={handleManualStyleChange}
                        className="w-full bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-3 text-sm text-indigo-100 placeholder-indigo-400/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none h-24 leading-relaxed transition-all hover:bg-indigo-950/60"
                        placeholder="Define el estilo visual..."
                    />
                </div>

                {/* Configuración Intro Dinámica */}
                <div className="relative z-10 bg-indigo-950/60 p-3 rounded-xl border border-yellow-500/20 flex flex-col gap-2 transition-all hover:border-yellow-500/40">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-yellow-100/90">
                             <Zap size={16} className={useDynamicIntro ? "text-yellow-400 fill-yellow-400 animate-pulse" : "text-slate-500"} />
                             <span className="text-xs font-bold uppercase tracking-wider">Intro Dinámica</span>
                        </div>
                        
                        <div 
                          onClick={() => setUseDynamicIntro(!useDynamicIntro)}
                          className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors border ${useDynamicIntro ? 'bg-yellow-500/20 border-yellow-500/50' : 'bg-slate-800 border-slate-700'}`}
                        >
                           <div className={`absolute top-1 w-3.5 h-3.5 bg-white rounded-full transition-all shadow-sm ${useDynamicIntro ? 'left-6 bg-yellow-400' : 'left-1 bg-slate-400'}`} />
                        </div>
                      </div>
                      
                      {useDynamicIntro && (
                          <div className="flex items-center gap-2 mt-1 animate-in fade-in slide-in-from-top-1 duration-200 pl-6">
                             <span className="text-xs text-indigo-200">Primeros</span>
                             <input 
                               type="number" 
                               min="1" 
                               max="50"
                               value={dynamicBlockCount}
                               onChange={(e) => setDynamicBlockCount(Number(e.target.value))}
                               className="w-10 bg-indigo-900/80 border border-indigo-500/50 rounded px-1 py-0.5 text-xs text-center text-white focus:outline-none focus:border-yellow-500"
                             />
                             <span className="text-xs text-indigo-200">bloques</span>
                          </div>
                      )}
                </div>

                <div className="flex flex-col gap-3 relative z-10 bg-indigo-950/30 p-3 rounded-xl border border-indigo-500/20">
                    <div className="flex items-center gap-3">
                        <ListOrdered size={16} className="text-indigo-400" />
                        <span className="text-xs font-medium text-indigo-200 flex-1">
                            Alcance:
                        </span>
                        <select 
                            value={generationLimit}
                            onChange={(e) => {
                                const val = e.target.value === 'custom' ? 'custom' : Number(e.target.value);
                                setGenerationLimit(val);
                            }}
                            className="bg-indigo-900/80 border border-indigo-500/40 text-indigo-100 text-xs rounded-lg px-2 py-1.5 focus:outline-none hover:bg-indigo-800 transition-colors cursor-pointer max-w-[140px]"
                        >
                            <option value={0}>Todo el Guion</option>
                            <option value={5}>Primeros 5</option>
                            <option value={10}>Primeros 10</option>
                            <option value={20}>Primeros 20</option>
                            <option value={40}>Primeros 40</option>
                            <option value="custom">Rango Personalizado</option>
                        </select>
                    </div>

                    {/* Inputs de Rango Personalizado */}
                    {generationLimit === 'custom' && (
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-indigo-500/20 animate-in fade-in slide-in-from-top-1">
                            <div className="space-y-1">
                                <label className="text-[10px] text-indigo-300 font-bold block">Desde Bloque</label>
                                <input 
                                    type="number" 
                                    min="1"
                                    max={processedBlocks.length}
                                    value={customStartBlock}
                                    onChange={(e) => setCustomStartBlock(Number(e.target.value))}
                                    className="w-full bg-indigo-900/80 border border-indigo-500/40 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-indigo-300 font-bold block">Hasta Bloque</label>
                                <input 
                                    type="number" 
                                    min="1"
                                    max={processedBlocks.length}
                                    value={customEndBlock}
                                    onChange={(e) => setCustomEndBlock(Number(e.target.value))}
                                    className="w-full bg-indigo-900/80 border border-indigo-500/40 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none"
                                />
                            </div>
                            <div className="col-span-2 space-y-1 pt-1">
                                <label className="text-[10px] text-yellow-200/80 font-bold flex items-center gap-1">
                                    <Hash size={10} /> Iniciar Numeración Prompt en:
                                </label>
                                <input 
                                    type="number" 
                                    min="1"
                                    value={customPromptStart}
                                    onChange={(e) => setCustomPromptStart(Number(e.target.value))}
                                    className="w-full bg-indigo-900/80 border border-yellow-500/40 text-yellow-100 text-xs rounded-lg px-2 py-1.5 focus:outline-none placeholder-indigo-400"
                                    placeholder="Ej: 80"
                                />
                                <p className="text-[9px] text-indigo-400 italic">Útil para continuar secuencias tras recargar.</p>
                            </div>
                        </div>
                    )}

                    {/* Prompts Intermedios (Condicional - Solo si NO es custom para evitar complejidad) */}
                    {generationLimit > 0 && generationLimit !== 'custom' && (
                        <div className="flex items-center gap-3 pt-2 border-t border-indigo-500/20 animate-in fade-in slide-in-from-top-1">
                            <MoreHorizontal size={16} className="text-indigo-400" />
                            <span className="text-xs font-medium text-indigo-200 flex-1">
                                Prompts Intermedios (Resto):
                            </span>
                            <div className="flex items-center gap-1">
                                <input 
                                    type="number" 
                                    min="0"
                                    max="100"
                                    value={intermediatePromptsCount}
                                    onChange={(e) => setIntermediatePromptsCount(Number(e.target.value))}
                                    className="w-12 bg-indigo-900/80 border border-indigo-500/40 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none text-center"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {isGenerating ? (
                    <div className="grid grid-cols-2 gap-2 relative z-10">
                        {generationStatus === 'paused' ? (
                            <button 
                                onClick={handleResumeGeneration}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/20 border border-emerald-500/30"
                            >
                                <Play size={18} fill="currentColor" /> Reanudar
                            </button>
                        ) : (
                            <button 
                                onClick={handlePauseGeneration}
                                className="bg-amber-600 hover:bg-amber-500 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-900/20 border border-amber-500/30"
                            >
                                <Pause size={18} fill="currentColor" /> Pausar
                            </button>
                        )}
                        
                        <button 
                            onClick={handleCancelGeneration}
                            className="bg-red-600 hover:bg-red-500 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-red-900/20 border border-red-500/30"
                        >
                            <XCircle size={18} /> Cancelar
                        </button>
                        
                        <div className="col-span-2 text-center text-[10px] text-indigo-300 mt-1 font-mono">
                            {generationStatus === 'paused' ? 'En Pausa' : `Generando... ${Math.round(generationProgress)}%`}
                        </div>
                    </div>
                ) : (
                    <button 
                        onClick={generatePromptsWithAI}
                        disabled={processedBlocks.length === 0}
                        className={`w-full py-3.5 rounded-xl font-bold text-sm shadow-lg shadow-indigo-900/30 flex items-center justify-center gap-2 transition-all relative z-10 active:scale-[0.98] ${
                            processedBlocks.length === 0 
                            ? 'bg-slate-700/50 cursor-not-allowed text-slate-400' 
                            : 'bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white border border-indigo-400/20'
                        }`}
                    >
                        <Wand2 size={18} /> Generar Prompts
                    </button>
                )}
                
                {/* Error Banner */}
                {errorMessage && (
                    <div className="bg-red-500/20 border border-red-500/50 p-3 rounded-lg flex items-start gap-2 text-red-200 text-xs mt-2 relative z-10 animate-in fade-in slide-in-from-top-1">
                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                        <span>{errorMessage}</span>
                    </div>
                )}
            </section>

            {/* Input Texto */}
            <section className="flex flex-col h-64 bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center px-4 pt-3 pb-1">
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">Guion Original</label>
                <button 
                  onClick={() => { setInputText(''); setGeneratedPrompts({}); setHiddenPrompts({}); setHistoricalContext(""); setCharacters([]); setErrorMessage(null); }}
                  className="text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-50 px-2 py-1 rounded transition-colors flex items-center gap-1 font-medium"
                >
                  <RotateCcw size={12} /> Limpiar
                </button>
              </div>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Pega tu guion narrativo aquí..."
                className="w-full h-full p-4 rounded-xl focus:outline-none resize-none font-mono text-sm leading-relaxed text-slate-700 placeholder-slate-300"
              />
            </section>
          </div>

          {/* Panel Derecho */}
          <div className="lg:col-span-7 flex flex-col h-full space-y-4">
            
            {/* Stats Header */}
            <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-6">
                <div className="text-center px-2">
                  <span className="block text-3xl font-black text-slate-800 tracking-tight">{processedBlocks.length}</span>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Bloques</span>
                </div>
                <div className="h-10 w-px bg-slate-100"></div>
                <div className="text-left">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Duración Total</div>
                    <div className="text-base font-bold text-indigo-600 flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-lg">
                      <Clock size={14} /> {calculateDurationDisplay(processedBlocks.join(' '))}
                    </div>
                </div>
              </div>

              <div className="flex gap-2">
                 <button 
                    onClick={downloadHTML}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300 hover:shadow-md transition-all active:scale-95"
                    title="Descargar versión HTML offline"
                 >
                    <Download size={16} /> Descargar HTML
                 </button>

                 {Object.keys(generatedPrompts).length > 0 && (
                    <button
                        onClick={copyAllPrompts}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm ${
                            copiedIndex === 'all-prompts'
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md hover:-translate-y-0.5'
                        }`}
                    >
                        {copiedIndex === 'all-prompts' ? <Check size={16} /> : <Layers size={16} />}
                        {copiedIndex === 'all-prompts' ? 'Copiado' : 'Copiar Todo'}
                    </button>
                 )}
              </div>
            </div>

            {/* Listado de Bloques */}
            <div className="flex-1 bg-white rounded-2xl border border-slate-200/60 p-1 overflow-hidden relative shadow-sm">
              {processedBlocks.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-4">
                  <div className="bg-slate-50 p-6 rounded-full border border-slate-100">
                    <AlignLeft size={48} className="opacity-50" />
                  </div>
                  <p className="font-medium">Ingresa un guion para comenzar</p>
                </div>
              ) : (
                <div className="h-full overflow-y-auto p-4 space-y-6 custom-scrollbar">
                  {processedBlocks.map((block, idx) => {
                    const durationSecs = getDurationSeconds(block);
                    const wordCount = typeof block === 'string' ? block.split(/\s+/).filter(w => w.length > 0).length : 0;
                    const prompts = generatedPrompts[idx];
                    
                    // Determinar qué tipo de bloque es visualmente
                    const isIntroBlock = useDynamicIntro && idx < dynamicBlockCount;

                    return (
                      <div key={idx} className={`group bg-white rounded-2xl shadow-sm border overflow-hidden transition-all duration-300 hover:shadow-lg ${isIntroBlock ? 'border-yellow-400/40 ring-1 ring-yellow-400/20' : 'border-slate-200'}`}>
                        
                        {/* Bloque Texto */}
                        <div className={`p-6 relative ${isIntroBlock ? 'bg-gradient-to-r from-yellow-50/80 to-orange-50/50' : 'bg-gradient-to-r from-slate-50/80 to-white'}`}>
                            <div className="flex justify-between items-center mb-4">
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg flex items-center gap-1.5 border ${isIntroBlock ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                    {isIntroBlock && <Zap size={12} className="fill-yellow-600" />} BLOQUE {idx + 1}
                                </span>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
                                        <Type size={12} /> {wordCount}
                                    </span>
                                    <span className={`text-xs font-bold flex items-center gap-1 px-2.5 py-1 rounded-full border ${
                                        durationSecs > 5 
                                          ? 'bg-amber-50 text-amber-600 border-amber-100' 
                                          : 'bg-indigo-50 text-indigo-600 border-indigo-100'
                                    }`}>
                                            <Clock size={12} /> {Math.round(durationSecs * 10) / 10}s
                                    </span>
                                </div>
                            </div>

                            <p className="text-lg text-slate-700 leading-relaxed font-serif pr-8 selection:bg-indigo-100 selection:text-indigo-900">
                                {block}
                            </p>

                            <button 
                                onClick={() => copyText(block, idx)}
                                className="absolute top-6 right-6 text-slate-300 hover:text-indigo-600 transition-colors p-1 hover:bg-slate-100 rounded-lg"
                            >
                                {copiedIndex === idx ? <Check size={18} /> : <Copy size={18} />}
                            </button>
                        </div>

                        {/* Prompts Texto */}
                        {prompts && Array.isArray(prompts) && prompts.length > 0 ? (
                            <div className="bg-white p-5 space-y-4 relative border-t border-slate-100">
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-slate-100 to-transparent opacity-50"></div>
                                
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                        <Film size={12} /> Prompts {isIntroBlock ? '(Dinámico)' : '(Estándar)'}
                                    </h4>
                                </div>

                                <div className="space-y-3">
                                    {prompts.map((promptText, pIdx) => {
                                        const promptId = `${idx}-${pIdx}`;
                                        const isHidden = hiddenPrompts[promptId];
                                        const globalNumber = getGlobalPromptNumber(idx, pIdx);
                                        
                                        // VISTA OCULTA
                                        if (isHidden) {
                                            return (
                                                <div key={pIdx} className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-3 flex items-center justify-between opacity-80 backdrop-blur-sm">
                                                    <div className="flex items-center gap-3">
                                                        <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-md">#{globalNumber}</span>
                                                        <span className="text-xs font-bold text-emerald-600 flex items-center gap-1"><Check size={12} /> Copiado</span>
                                                        <span className="text-xs text-slate-400 truncate max-w-[200px]">{promptText}</span>
                                                    </div>
                                                    <button onClick={() => togglePromptVisibility(idx, pIdx)} className="text-slate-400 hover:text-indigo-600 p-1.5 hover:bg-emerald-100/50 rounded-lg transition-colors">
                                                        <RotateCcw size={14} />
                                                    </button>
                                                </div>
                                            );
                                        }

                                        // VISTA COMPLETA (TEXTO)
                                        return (
                                        <div key={pIdx} className="bg-slate-50/50 border border-slate-200/60 rounded-xl p-4 relative shadow-sm hover:shadow-md transition-all group/prompt hover:border-indigo-200 hover:bg-white">
                                            {/* Header */}
                                            <div className="flex gap-3 mb-3 border-b border-slate-100 pb-2">
                                                <div className={`text-white text-xs font-bold px-2 py-1 rounded-lg flex items-center justify-center min-w-[32px] shadow-sm ${isIntroBlock ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 'bg-gradient-to-br from-indigo-500 to-violet-600'}`}>
                                                    #{globalNumber}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between items-start">
                                                        <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-1 rounded-md">
                                                            {isIntroBlock 
                                                                ? `Dinámico (~${Math.round(durationSecs / prompts.length)}s)` 
                                                                : `${SCENE_DURATION_STD}.0s Clip`
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* Contenido Prompt */}
                                            <div className="mb-4">
                                                <p className="text-sm text-slate-600 leading-relaxed group-hover/prompt:text-slate-800 transition-colors">
                                                    {promptText}
                                                </p>
                                                <div className="mt-2 text-[10px] text-slate-400 pt-2 border-t border-slate-100 italic flex items-center gap-1">
                                                    <Sparkles size={10} /> Se añadirá el estilo visual al copiar
                                                </div>
                                            </div>

                                            {/* Botonera */}
                                            <div className="flex items-center justify-end gap-2">
                                                <button 
                                                    onClick={() => regenerateSinglePrompt(idx, pIdx, promptText)}
                                                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-all"
                                                >
                                                    {regeneratingId === promptId ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                                    <span className="hidden sm:inline">Regenerar</span>
                                                </button>

                                                <button 
                                                    onClick={() => copyPrompt(promptText, idx, pIdx)}
                                                    className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all active:scale-95 ${
                                                        copiedIndex === promptId
                                                        ? 'bg-emerald-500 text-white border-emerald-600 ring-2 ring-emerald-200'
                                                        : 'bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-700 hover:shadow-indigo-200'
                                                    }`}
                                                >
                                                    {copiedIndex === promptId ? <Check size={14} /> : <Copy size={14} />}
                                                    {copiedIndex === promptId ? 'Copiado' : 'Copiar'}
                                                </button>
                                                
                                                <button 
                                                    onClick={() => togglePromptVisibility(idx, pIdx)}
                                                    className="text-slate-300 hover:text-slate-500 p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                                                    title="Ocultar"
                                                >
                                                    <EyeOff size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    )})}
                                </div>
                            </div>
                        ) : prompts && Array.isArray(prompts) && prompts.length === 0 ? (
                            <div className="bg-slate-50/50 border-t border-slate-100 p-4 text-center">
                                <span className="text-xs text-slate-400 italic flex items-center justify-center gap-2">
                                    <Clock size={12} />
                                    {isIntroBlock 
                                        ? "Este bloque se unió al anterior o no generó escena." 
                                        : `Contenido agrupado en la siguiente escena por duración (${SCENE_DURATION_STD}s)...`
                                    }
                                </span>
                            </div>
                        ) : null}
                      </div>
                    );
                  })}
                  <div className="h-24" />
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #94a3b8; }
      `}</style>
    </div>
  );
};

export default App;