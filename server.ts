import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Helper for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Robust JSON extraction from AI response
const extractJson = (text: string) => {
  try {
    const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        throw new Error("Respuesta de IA no procesable");
      }
    }
    throw new Error("Formato de respuesta inválido");
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

// API Routes
app.post('/api/analyze', async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image || !mimeType) return res.status(400).json({ error: 'Imagen requerida' });

    const prompt = "Analiza esta captura de pantalla de un perfil de Instagram y extrae la siguiente información en formato JSON: brandName (Nombre de la marca), username (Handle/Username con @), followers (Número de seguidores como entero o string con K/M), industry (Industria/Sector inferido), contact (Email si aparece), phone (Número de teléfono si aparece), profileLink (Link al perfil si se puede inferir).";

    const attempts = [
      { type: 'google' },
      { type: 'openrouter', model: 'google/gemini-flash-1.5' },
      { type: 'openrouter', model: 'openai/gpt-4o-mini' }
    ];

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      try {
        console.log(`[Analizando] Intento ${i + 1}: ${attempt.type}`);
        let text = "";

        if (attempt.type === 'google') {
          text = await callGeminiDirect(image, mimeType, prompt);
        } else {
          text = await callOpenRouterDirect(image, mimeType, prompt, attempt.model!);
        }

        if (text) {
          const jsonData = extractJson(text);
          console.log(`[Éxito] Analizado con ${attempt.type}`);
          return res.json(jsonData);
        }
      } catch (err: any) {
        console.error(`[Error] Intento ${i + 1} falló:`, err.message);
        if (i < attempts.length - 1) await new Promise(r => setTimeout(r, 400));
      }
    }

    throw new Error("No ha sido posible conectar con la IA. Por favor, revisa tus API Keys en Vercel.");
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

    console.log(`Intentando acceder a la hoja: ${SPREADSHEET_ID} con el email: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);

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

    // Last 5 records
    const last5 = data.slice(-5).reverse();

    // Total ARR
    const totalARR = data.reduce((sum, item) => {
      const arrValue = parseFloat(item.ARR?.replace(/[€$,]/g, '') || '0');
      return sum + (isNaN(arrValue) ? 0 : arrValue);
    }, 0);

    res.json({ last5, totalARR });
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
        // Si solo hay coma, podría ser decimal (si hay 1 o 2 digitos después) o miles
        const parts = s.split(',');
        if (parts[parts.length - 1].length <= 2) s = s.replace(',', '.');
        else s = s.replace(',', '');
      }
      
      const num = parseFloat(s) || 0;
      return Math.round(num * multiplier);
    };

    const parsedFollowersNum = parseFollowers(followers);
    const calculatedARR = (parsedFollowersNum * 2.15).toFixed(2) + '€';

    console.log(`Intentando guardar prospecto: ${username}. Followers detectados: ${parsedFollowersNum}, ARR Calculado: ${calculatedARR}`);

    // Check for duplicates
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = existing.data.values || [];
    
    // If sheet is empty, add headers first
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

    // Add new row
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

// Vite middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
