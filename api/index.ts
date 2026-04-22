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
    // Intento 1: Limpieza de markdown blocks
    const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (e) {
    // Intento 2: Buscar bloques { ... } o [ ... ]
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        throw new Error("No se pudo extraer JSON válido de la respuesta de la IA");
      }
    }
    throw new Error("La IA no devolvió un formato JSON válido");
  }
};

// OpenRouter Fallback Helper
const callOpenRouter = async (image: string, mimeType: string, prompt: string) => {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim().replace(/["']/g, '');
  if (!apiKey) {
    console.warn('OPENROUTER_API_KEY is missing, skipping fallback');
    return null;
  }

  try {
    console.log('Intentando fallback con OpenRouter...');
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "https://huboo-prospector.vercel.app",
        "X-Title": "Outbound Huboo Prospector"
      },
      body: JSON.stringify({
        "model": "google/gemini-flash-1.5",
        "messages": [
          {
            "role": "user",
            "content": [
              { "type": "text", "text": prompt },
              {
                "type": "image_url",
                "image_url": {
                  "url": `data:${mimeType};base64,${image}`
                }
              }
            ]
          }
        ]
      })
    });

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('OpenRouter Exception:', error);
    return null;
  }
};

// Groq Fallback Helper
const callGroq = async (image: string, mimeType: string, prompt: string) => {
  const apiKey = (process.env.GROQ_API_KEY || '').trim().replace(/["']/g, '');
  if (!apiKey) {
    console.warn('GROQ_API_KEY is missing, skipping fallback');
    return null;
  }

  try {
    console.log('Intentando fallback con Groq...');
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": "llama-3.2-11b-vision-preview",
        "messages": [
          {
            "role": "user",
            "content": [
              { "type": "text", "text": prompt },
              {
                "type": "image_url",
                "image_url": {
                  "url": `data:${mimeType};base64,${image}`
                }
              }
            ]
          }
        ]
      })
    });

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('Groq Exception:', error);
    return null;
  }
};

// AI/ML API Fallback Helper
const callAIML = async (image: string, mimeType: string, prompt: string) => {
  const apiKey = (process.env.AIML_API_KEY || '').trim().replace(/["']/g, '');
  if (!apiKey) {
    console.warn('AIML_API_KEY is missing, skipping fallback');
    return null;
  }

  try {
    console.log('Intentando fallback con AI/ML API...');
    const response = await fetch("https://api.aimlapi.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": "google/gemini-1.5-flash",
        "messages": [
          {
            "role": "user",
            "content": [
              { "type": "text", "text": prompt },
              {
                "type": "image_url",
                "image_url": {
                  "url": `data:${mimeType};base64,${image}`
                }
              }
            ]
          }
        ]
      })
    });

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('AI/ML API Exception:', error);
    return null;
  }
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
    if (!image || !mimeType) {
      return res.status(400).json({ error: 'Imagen y tipo MIME son requeridos' });
    }

    const genAI = getGenAI();
    if (!genAI) {
      return res.status(500).json({ error: 'Configuración de IA incompleta (Falta API Key)' });
    }

    const prompt = "Analiza esta captura de pantalla de un perfil de Instagram y extrae la siguiente información en formato JSON: brandName (Nombre de la marca), username (Handle/Username con @), followers (Número de seguidores como entero o string con K/M), industry (Industria/Sector inferido), contact (Email si aparece), phone (Número de teléfono si aparece), profileLink (Link al perfil si se puede inferir).";

    try {
      // Priorizamos v1beta ya que es el más estable para este tipo de prompts
      const attempts = [
        { type: 'google', model: 'gemini-1.5-flash', version: 'v1beta' },
        { type: 'google', model: 'gemini-1.5-flash-latest', version: 'v1beta' },
        { type: 'openrouter', model: 'google/gemini-flash-1.5' },
        { type: 'openrouter', model: 'openai/gpt-4o-mini' }
      ];

      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        try {
          console.log(`[Analizando] Intento ${i + 1}: ${attempt.model} (${attempt.type})`);
          let text = "";

          if (attempt.type === 'google') {
            const genAI = getGenAI();
            if (!genAI) throw new Error("API Key de Gemini no configurada");
            const model = genAI.getGenerativeModel({ model: attempt.model }, { apiVersion: attempt.version as any });
            const result = await model.generateContent([
              { inlineData: { mimeType, data: image } },
              { text: prompt },
            ]);
            text = (await result.response).text();
          } else {
            const apiKey = (process.env.OPENROUTER_API_KEY || '').trim().replace(/["']/g, '');
            if (!apiKey) throw new Error("API Key de OpenRouter no configurada");
            
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                "model": attempt.model,
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
            text = data.choices?.[0]?.message?.content || "";
          }

          if (text) {
            const jsonData = extractJson(text);
            console.log(`[Éxito] Analizado con ${attempt.model}`);
            return res.json(jsonData);
          }
        } catch (err: any) {
          console.error(`[Error] Intento ${i + 1} (${attempt.model}):`, err.message);
          // Delay mínimo para no agotar timeout de Vercel
          if (i < attempts.length - 1) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }

      throw new Error(`No hemos podido conectar con los servicios de IA tras varios intentos. Por favor, revisa tus API Keys en Vercel.`);
    } catch (finalError: any) {
      console.error('Análisis fallido totalmente:', finalError.message);
      res.status(500).json({ error: finalError.message });
    }
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
