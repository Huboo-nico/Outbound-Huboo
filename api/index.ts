import express from 'express';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Helper for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Gemini Setup
const getGenAI = () => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/["']/g, '');
  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing');
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
};

// Robust JSON extraction from AI response
const extractJson = (text: string) => {
  try {
    // 1. Intentar limpiar bloques markdown
    const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
    // 2. Buscar el primer '{' y el último '}' para ignorar basura fuera del JSON
    const firstBrace = cleanJson.indexOf('{');
    const lastBrace = cleanJson.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1) {
      const jsonCandidate = cleanJson.substring(firstBrace, lastBrace + 1);
      return JSON.parse(jsonCandidate);
    }
    
    return JSON.parse(cleanJson);
  } catch (e) {
    // Fallback con regex si falla el parse básico
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        throw new Error(`Contenido mal formado: ${text.substring(0, 50)}...`);
      }
    }
    throw new Error("No se encontró un JSON válido en la respuesta");
  }
};

// Direct REST call to Gemini (More reliable in Serverless)
const callGeminiDirect = async (image: string, mimeType: string, prompt: string) => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/["']/g, '');
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: image } }
        ]
      }]
    })
  });

  const data: any = await response.json();
  if (data.error) throw new Error(data.error.message || "Error en Gemini API");
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
};

// Direct REST call to OpenRouter
const callOpenRouterDirect = async (image: string, mimeType: string, prompt: string, model: string) => {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim().replace(/["']/g, '');
  if (!apiKey) throw new Error("OPENROUTER_API_KEY no configurada");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://huboo-prospector.vercel.app",
      "X-Title": "Outbound Huboo Prospector"
    },
    body: JSON.stringify({
      "model": model,
      "messages": [
        {
          "role": "user",
          "content": [
            { "type": "text", "text": prompt },
            { "type": "image_url", "image_url": { "url": `data:${mimeType};base64,${image}` } }
          ]
        }
      ]
    })
  });

  const data: any = await response.json();
  if (data.error) throw new Error(data.error.message || "Error en OpenRouter");
  return data.choices?.[0]?.message?.content || "";
};

// Google Sheets Setup
const getSheetsClient = () => {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !privateKey) {
    console.error('Missing Google Sheets credentials in environment variables');
    return null;
  }

  // Clean up private key: handle literal \n strings and potential quotes
  privateKey = privateKey.replace(/\\n/g, '\n').replace(/"/g, '');

  try {
    const auth = new JWT({
      email,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    console.error('Error initializing Google Sheets auth:', error);
    return null;
  }
};

const getSpreadsheetId = () => {
  let id = process.env.GOOGLE_SHEETS_ID;
  if (id?.includes('docs.google.com/spreadsheets/d/')) {
    id = id.split('/d/')[1].split('/')[0];
  }
  return id;
};

const SPREADSHEET_ID = getSpreadsheetId();
const RANGE = 'Sheet1!A:I';

// Direct REST call to NVIDIA
const callNvidiaDirect = async (image: string, mimeType: string, prompt: string) => {
  const apiKey = (process.env.NVIDIA_API_KEY || '').trim().replace(/["']/g, '');
  if (!apiKey) throw new Error("NVIDIA_API_KEY no configurada");

  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      "model": "nvidia/llama-3.2-11b-vision-instruct",
      "messages": [
        {
          "role": "user",
          "content": [
            { "type": "text", "text": prompt },
            { "type": "image_url", "image_url": { "url": `data:${mimeType};base64,${image}` } }
          ]
        }
      ],
      "max_tokens": 1024
    })
  });

  const data: any = await response.json();
  if (data.error) throw new Error(data.error.message || "Error en NVIDIA API");
  return data.choices?.[0]?.message?.content || "";
};

// Direct REST call to Mistral
const callMistralDirect = async (image: string, mimeType: string, prompt: string) => {
  const apiKey = (process.env.MISTRAL_API_KEY || '').trim().replace(/["']/g, '');
  if (!apiKey) throw new Error("MISTRAL_API_KEY no configurada");

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      "model": "pixtral-12b-2409",
      "messages": [
        {
          "role": "user",
          "content": [
            { "type": "text", "text": prompt },
            { "type": "image_url", "image_url": `data:${mimeType};base64,${image}` }
          ]
        }
      ]
    })
  });

  const data: any = await response.json();
  if (data.error) throw new Error(data.error.message || "Error en Mistral API");
  return data.choices?.[0]?.message?.content || "";
};

// AI Models Health Check
app.get('/api/health', async (req, res) => {
  const status = {
    gemini: !!process.env.GEMINI_API_KEY,
    nvidia: !!process.env.NVIDIA_API_KEY,
    mistral: !!process.env.MISTRAL_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
    sheets: !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY && process.env.GOOGLE_SHEETS_ID)
  };
  res.json(status);
});

// API Routes
app.post('/api/analyze', async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image || !mimeType) return res.status(400).json({ error: 'Imagen requerida' });

    const prompt = "Analiza esta captura de pantalla de un perfil de Instagram y extrae la siguiente información en formato JSON: brandName (Nombre de la marca), username (Handle/Username con @), followers (Número de seguidores como entero o string con K/M), industry (Industria/Sector inferido), contact (Email si aparece), phone (Número de teléfono si aparece), profileLink (Link al perfil si se puede inferir). RESPONDE SOLO EL JSON.";

    const providers = [
      { 
        name: 'Gemini Primary (Direct)', 
        key: 'GEMINI_API_KEY',
        fn: () => callGeminiDirect(image, mimeType, prompt) 
      },
      { 
        name: 'Gemini Retry (Wait Strategy)', 
        key: 'GEMINI_API_KEY',
        fn: async () => {
          console.log("[Analizando] Aplicando estrategia de espera (2s)...");
          await delay(2000);
          const genAI = getGenAI();
          if (!genAI) throw new Error("Gemini SDK no disponible");
          const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
          const result = await model.generateContent([
            { inlineData: { mimeType, data: image } },
            { text: prompt },
          ]);
          return (await result.response).text();
        }
      },
      { 
        name: 'NVIDIA Vision (Fallback)', 
        key: 'NVIDIA_API_KEY',
        fn: () => callNvidiaDirect(image, mimeType, prompt) 
      },
      { 
        name: 'Mistral Vision (Fallback)', 
        key: 'MISTRAL_API_KEY',
        fn: () => callMistralDirect(image, mimeType, prompt) 
      },
      { 
        name: 'OpenRouter Gemini (Fallback)', 
        key: 'OPENROUTER_API_KEY',
        fn: () => callOpenRouterDirect(image, mimeType, prompt, 'google/gemini-flash-1.5') 
      },
      { 
        name: 'OpenRouter Llama Vision (Fallback)', 
        key: 'OPENROUTER_API_KEY',
        fn: () => callOpenRouterDirect(image, mimeType, prompt, 'meta-llama/llama-3.2-11b-vision-instruct') 
      }
    ];

    let lastError = "";
    let diagnosticLog = [];

    for (const provider of providers) {
      const apiKey = process.env[provider.key];
      if (!apiKey) {
        diagnosticLog.push(`${provider.name}: Saltado (Falta API Key)`);
        continue;
      }

      try {
        console.log(`[Analizando] Intentando con: ${provider.name}`);
        const text = await provider.fn();
        if (text) {
          const jsonData = extractJson(text);
          console.log(`[Éxito] Analizado con: ${provider.name}`);
          return res.json(jsonData);
        }
      } catch (err: any) {
        lastError = err.message;
        const shortError = err.message.substring(0, 50);
        console.error(`[Fallo] ${provider.name}: ${shortError}`);
        diagnosticLog.push(`${provider.name}: Error (${shortError})`);
        
        // Si el error es de créditos en OpenRouter, seguimos al siguiente
        if (err.message.includes('credits')) continue;
        
        // Pequeña pausa entre diferentes proveedores para evitar saturación de red
        await delay(300);
      }
    }

    throw new Error(`Análisis fallido tras intentar con todos los proveedores. Último error: ${lastError}. Diagnóstico: ${diagnosticLog.join(' | ')}`);
  } catch (error: any) {
    console.error('Error in /api/analyze:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/prospects', async (req, res) => {
  try {
    const sheets = getSheetsClient();
    if (!sheets) {
      return res.status(500).json({ error: 'Error de autenticación con Google (Revisa los Secrets)' });
    }
    if (!SPREADSHEET_ID) {
      return res.status(500).json({ error: 'ID de Google Sheet no configurado' });
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return res.json({ last5: [], totalARR: 0 });
    }
    const headers = rows[0] || [];
    const data = rows.slice(1).map(row => {
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    });

    const last5 = data.slice(-5).reverse();
    const totalARR = data.reduce((sum, item) => {
      let val = (item.ARR || '').toString().replace(/[€$]/g, '').trim();
      // If it contains both . and , it's likely formatted. 
      // Example: 1.234,56 or 1,234.56
      if (val.includes('.') && val.includes(',')) {
        if (val.lastIndexOf('.') > val.lastIndexOf(',')) {
          // US Format: 1,234.56 -> remove comma
          val = val.replace(/,/g, '');
        } else {
          // EU Format: 1.234,56 -> remove dot, replace comma with dot
          val = val.replace(/\./g, '').replace(',', '.');
        }
      } else if (val.includes(',')) {
        // Only comma: could be 1234,56 (EU) or 1,234 (US thousand)
        // If it's followed by 2 digits, it's likely decimal
        const parts = val.split(',');
        if (parts[parts.length - 1].length === 2) {
          val = val.replace(',', '.');
        } else {
          val = val.replace(',', '');
        }
      }
      const arrValue = parseFloat(val || '0');
      return sum + (isNaN(arrValue) ? 0 : arrValue);
    }, 0);

    res.json({ 
      last5, 
      totalARR,
      totalProspects: data.length
    });
  } catch (error: any) {
    console.error('Error fetching prospects:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/prospects', async (req, res) => {
  try {
    const sheets = getSheetsClient();
    if (!sheets) {
      return res.status(500).json({ error: 'Error de autenticación con Google (Revisa los Secrets)' });
    }
    if (!SPREADSHEET_ID) {
      return res.status(500).json({ error: 'ID de Google Sheet no configurado' });
    }

    const { name, username, followers, sector, arr, contact, phone, link } = req.body;

    // Calcular ARR usando la fórmula: Followers * 2.15
    // Mejoramos el parseo para manejar "1.5K", "10,5K", etc.
    const parseFollowers = (val: string | number): number => {
      if (!val) return 0;
      let s = val.toString().toLowerCase().trim();
      let multiplier = 1;
      
      if (s.endsWith('k')) {
        multiplier = 1000;
        s = s.slice(0, -1);
      } else if (s.endsWith('m')) {
        multiplier = 1000000;
        s = s.slice(0, -1);
      }
      
      // Limpiar caracteres no numéricos excepto punto y coma
      s = s.replace(/[^0-9.,]/g, '');
      
      // Manejar formato europeo (coma decimal) vs americano (punto decimal)
      if (s.includes(',') && s.includes('.')) {
        if (s.indexOf(',') > s.indexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
        else s = s.replace(/,/g, '');
      } else if (s.includes(',')) {
        const parts = s.split(',');
        if (parts[parts.length - 1].length <= 2) s = s.replace(',', '.');
        else s = s.replace(',', '');
      }
      
      const num = parseFloat(s) || 0;
      return Math.round(num * multiplier);
    };

    const parsedFollowersNum = parseFollowers(followers);
    const calculatedARR = (parsedFollowersNum * 2.15).toFixed(2) + '€';

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = existing.data.values || [];
    
    if (rows.length === 0) {
      const headers = ['Date', 'Name', 'Username', 'Followers', 'Sector', 'ARR', 'Contact', 'Phone', 'Link'];
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A1:I1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] },
      });
      rows.push(headers);
    }

    const usernameIndex = rows[0]?.indexOf('Username');
    if (usernameIndex !== undefined && usernameIndex !== -1) {
      const duplicate = rows.some(row => row[usernameIndex] === username);
      if (duplicate) {
        return res.status(400).json({ error: 'Este usuario ya ha sido prospectado (Duplicado)' });
      }
    }

    const date = new Date().toISOString().split('T')[0];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[date, name, username, followers, sector, calculatedARR, contact, phone, link]],
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error adding prospect:', error);
    res.status(500).json({ error: error.message });
  }
});

export default app;
