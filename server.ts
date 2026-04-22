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

// Gemini Setup
const getGenAI = () => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/["']/g, '');
  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing');
    return null;
  }
  // Forzamos v1beta ya que es lo que funcionó en el curl del usuario
  return new GoogleGenerativeAI(apiKey);
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
        "HTTP-Referer": process.env.APP_URL || "https://ai.studio",
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
    if (data.error) {
      console.error('OpenRouter Error:', data.error);
      return null;
    }
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

    // Usamos el alias más compatible con explicit apiVersion
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }, { apiVersion: 'v1beta' });
    
    const prompt = "Analiza esta captura de pantalla de un perfil de Instagram y extrae la siguiente información en formato JSON: brandName (Nombre de la marca), username (Handle/Username con @), followers (Número de seguidores como entero), industry (Industria/Sector inferido), contact (Email si aparece), phone (Número de teléfono si aparece), profileLink (Link al perfil si se puede inferir).";

    try {
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: mimeType,
            data: image,
          },
        },
        { text: prompt },
      ]);

      const response = await result.response;
      const text = response.text();
      
      const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
      res.json(JSON.parse(cleanJson));
    } catch (apiError: any) {
      console.error('Gemini API Error:', apiError);
      
      // Si falla, intentamos con varios fallbacks y versiones
      if (apiError.message?.includes('404') || apiError.message?.includes('not found')) {
        const fallbacks = [
          { name: "gemini-1.5-flash-latest", version: 'v1beta' },
          { name: "gemini-flash-latest", version: 'v1beta' },
          { name: "gemini-1.5-flash", version: 'v1' },
          { name: "gemini-1.5-pro", version: 'v1beta' }
        ];
        
        for (const fb of fallbacks) {
          try {
            console.log(`Intentando fallback: ${fb.name} (${fb.version})`);
            const fallbackModel = genAI.getGenerativeModel({ model: fb.name }, { apiVersion: fb.version });
            const result = await fallbackModel.generateContent([
              { inlineData: { mimeType, data: image } },
              { text: prompt },
            ]);
            const response = await result.response;
            const text = response.text();
            const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
            return res.json(JSON.parse(cleanJson));
          } catch (e) {
            console.warn(`Fallback to ${fb.name} failed:`, e);
            continue;
          }
        }

        // --- ÚLTIMA OPCIÓN: OPENROUTER ---
        const orResult = await callOpenRouter(image, mimeType, prompt);
        if (orResult) {
          const cleanJson = orResult.replace(/```json\n?|\n?```/g, '').trim();
          return res.json(JSON.parse(cleanJson));
        }

        // --- ÚLTIMA OPCIÓN: GROQ ---
        const groqResult = await callGroq(image, mimeType, prompt);
        if (groqResult) {
          const cleanJson = groqResult.replace(/```json\n?|\n?```/g, '').trim();
          return res.json(JSON.parse(cleanJson));
        }

        // --- ÚLTIMA OPCIÓN: AI/ML API ---
        const aimlResult = await callAIML(image, mimeType, prompt);
        if (aimlResult) {
          const cleanJson = aimlResult.replace(/```json\n?|\n?```/g, '').trim();
          return res.json(JSON.parse(cleanJson));
        }

        throw new Error(`Error de modelo (404): No se encontró un modelo compatible en Google Cloud, OpenRouter, Groq ni AI/ML API. Verifica tus API Keys.`);
      }
      
      if (apiError.message?.includes('429')) {
        throw new Error('Límite de cuota excedido. Por favor, espera un minuto antes de intentar de nuevo.');
      }
      
      throw apiError;
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
    const parsedFollowers = parseInt(followers?.toString().replace(/[^0-9]/g, '') || '0');
    const calculatedARR = (parsedFollowers * 2.15).toFixed(2) + '€';

    console.log(`Intentando guardar prospecto: ${username} en la hoja. ARR Calculado: ${calculatedARR}`);

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
