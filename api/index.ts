import express from 'express';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Gemini Setup
const getGenAI = () => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/["']/g, '');
  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing');
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
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
        throw new Error(`Error de modelo (404): No se encontró un modelo compatible. Verifica que Gemini esté habilitado en tu consola de Google Cloud y que tu API Key sea válida para modelos 'flash'.`);
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
        values: [[date, name, username, followers, sector, arr, contact, phone, link]],
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error adding prospect:', error);
    res.status(500).json({ error: error.message });
  }
});

export default app;
