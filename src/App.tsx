/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast, Toaster } from 'sonner';
import { 
  Upload, 
  Instagram, 
  TrendingUp, 
  Users, 
  Briefcase, 
  Mail, 
  ExternalLink,
  Loader2,
  Plus,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

// Constants
const FOLLOWERS_MULTIPLIER = 2.15;
const HIGH_POTENTIAL_THRESHOLD = 500000;

interface Prospect {
  Date: string;
  Name: string;
  Username: string;
  Followers: string;
  Sector: string;
  ARR: string;
  Contact: string;
  Phone: string;
  Link: string;
}

interface ExtractedData {
  brandName: string;
  username: string;
  followers: number;
  industry: string;
  contact: string;
  phone: string;
  profileLink: string;
}

export default function App() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [lastProspects, setLastProspects] = useState<Prospect[]>([]);
  const [totalARR, setTotalARR] = useState(0);
  const [totalProspects, setTotalProspects] = useState(0);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [apiStatus, setApiStatus] = useState<{ gemini: boolean; nvidia: boolean; mistral: boolean; openrouter: boolean; sheets: boolean }>({
    gemini: false,
    nvidia: false,
    mistral: false,
    openrouter: false,
    sheets: false
  });

  const checkApiStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/health');
      if (response.ok) {
        const status = await response.json();
        setApiStatus(status);
      }
    } catch (error) {
      console.error('Error checking API status:', error);
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    try {
      const response = await fetch('/api/prospects');
      if (response.ok) {
        const data = await response.json();
        setLastProspects(data.last5 || []);
        setTotalARR(data.totalARR || 0);
        setTotalProspects(data.totalProspects || 0);
      } else {
        const errorData = await response.json();
        console.error('Error loading dashboard:', errorData.error);
        toast.error('Error al cargar datos: ' + (errorData.error || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
    checkApiStatus();
  }, [loadDashboardData, checkApiStatus]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setIsAnalyzing(true);
    setExtractedData(null);

    try {
      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      const base64String = await base64Promise;
      const base64Data = base64String.split(',')[1];

      // Call server-side API for analysis
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Data,
          mimeType: file.type
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al analizar la imagen');
      }

      const result = await response.json();
      setExtractedData(result);
      toast.success('Análisis completado con éxito');
    } catch (error: any) {
      console.error('Error analyzing image:', error);
      toast.error('Error al analizar la imagen: ' + error.message);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles: File[]) => onDrop(acceptedFiles),
    accept: { 'image/*': [] },
    multiple: false
  } as any);

  const parseFollowers = (val: string | number): number => {
    if (!val) return 0;
    let s = val.toString().toLowerCase().trim();
    let multiplier = 1;

    // Handle Spanish and English suffixes
    if (s.includes('mil') || s.endsWith('k')) {
      multiplier = 1000;
      s = s.replace('mil', '').replace('k', '').trim();
    } else if (s.includes('millón') || s.includes('millon') || s.endsWith('m')) {
      multiplier = 1000000;
      s = s.replace('millones', '').replace('millón', '').replace('millon', '').replace('m', '').trim();
    }

    // Clean up thousand separators and normalize decimal point
    s = s.replace(/[^0-9.,]/g, '');

    if (s.includes(',') && s.includes('.')) {
      // European style: 1.234,56 -> 1234.56
      if (s.indexOf('.') < s.indexOf(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        // American style: 1,234.56 -> 1234.56
        s = s.replace(/,/g, '');
      }
    } else if (s.includes(',')) {
      // Single separator ",": 10,7 (decimal) or 10,000 (thousands)
      const parts = s.split(',');
      if (parts[parts.length - 1].length === 3 && multiplier === 1) {
        s = s.replace(',', '');
      } else {
        s = s.replace(',', '.');
      }
    } else if (s.includes('.')) {
      // Single separator ".": 10.7 (decimal) or 10.000 (thousands)
      const parts = s.split('.');
      if (parts[parts.length - 1].length === 3 && multiplier === 1) {
        s = s.replace(/\./g, '');
      }
    }

    const num = parseFloat(s) || 0;
    const finalVal = Math.round(num * multiplier);
    console.log(`[ParseFollowers] Initial: ${val} -> Final: ${finalVal}`);
    return finalVal;
  };

  const handleSave = async () => {
    if (!extractedData) return;

    setIsSaving(true);
    const followersNum = parseFollowers(extractedData.followers);
    const arr = followersNum * FOLLOWERS_MULTIPLIER;
    
    try {
      const response = await fetch('/api/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: extractedData.brandName,
          username: extractedData.username,
          followers: extractedData.followers,
          sector: extractedData.industry,
          arr: `${arr.toLocaleString()}€`,
          contact: extractedData.contact || 'N/A',
          phone: extractedData.phone || 'N/A',
          link: extractedData.profileLink || `https://instagram.com/${extractedData.username.replace('@', '')}`
        }),
      });

      const result = await response.json();
      if (response.ok) {
        toast.success('Prospecto guardado correctamente');
        setExtractedData(null);
        loadDashboardData();
      } else {
        toast.error(result.error || 'Error al guardar');
      }
    } catch (error: any) {
      toast.error('Error de conexión: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const calculateARR = (followers: number) => followers * FOLLOWERS_MULTIPLIER;
  const getCategory = (arr: number) => arr > HIGH_POTENTIAL_THRESHOLD ? 'High Potential' : 'Mid Market';

  // Helper to safely render potentially complex values from AI
  const safeRender = (val: any) => {
    if (val === null || val === undefined) return 'N/A';
    if (typeof val === 'object') {
      return Object.values(val).filter(v => v !== null && v !== undefined).join(', ');
    }
    return val.toString();
  };

  return (
    <div className="min-h-screen bg-bento-bg text-foreground font-sans selection:bg-huboo-blue/20">
      <Toaster position="top-right" richColors />
      
      {/* Header */}
      <header className="bg-bento-sidebar text-white border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10">
              <img 
                src="/logo.png" 
                alt="Huboo Logo" 
                className="w-full h-full object-contain rounded-md shadow-sm border border-white/10"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.parentElement?.querySelector('.logo-fallback');
                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                }}
              />
              <div className="logo-fallback hidden absolute inset-0 items-center justify-center bg-huboo-blue rounded-md border border-white/10">
                <Instagram size={20} className="text-white" />
              </div>
            </div>
            <div className="flex flex-col">
              <h1 className="text-sm font-bold tracking-tight leading-none">OUTBOUND HUBOO</h1>
              <div className="flex gap-2 mt-1">
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${apiStatus.gemini ? 'bg-green-400 shadow-[0_0_5px_rgba(74,222,128,0.5)]' : 'bg-red-400'}`} title="Gemini Status" />
                  <span className="text-[8px] opacity-50 uppercase font-bold">GEM</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${apiStatus.nvidia ? 'bg-green-400 shadow-[0_0_5px_rgba(74,222,128,0.5)]' : 'bg-red-400'}`} title="Nvidia Status" />
                  <span className="text-[8px] opacity-50 uppercase font-bold">NVI</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${apiStatus.mistral ? 'bg-green-400 shadow-[0_0_5px_rgba(74,222,128,0.5)]' : 'bg-red-400'}`} title="Mistral Status" />
                  <span className="text-[8px] opacity-50 uppercase font-bold">MIS</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${apiStatus.openrouter ? 'bg-green-400 shadow-[0_0_5px_rgba(74,222,128,0.5)]' : 'bg-red-400'}`} title="OpenRouter Status" />
                  <span className="text-[8px] opacity-50 uppercase font-bold">OR</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${apiStatus.sheets ? 'bg-green-400 shadow-[0_0_5px_rgba(74,222,128,0.5)]' : 'bg-red-400'}`} title="Sheets Status" />
                  <span className="text-[8px] opacity-50 uppercase font-bold">GSH</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs opacity-70 hidden sm:inline">Sesión: BD Manager (Spain)</span>
            <Badge variant="outline" className="bg-white/10 text-white border-white/20 px-3 py-1">
              Live Dashboard
            </Badge>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-12 gap-4">
          {/* Metrics Row */}
          <Card className="col-span-12 md:col-span-4 border-bento-border shadow-none flex flex-col justify-center text-center p-6">
            <span className="text-[10px] text-bento-text-muted uppercase tracking-widest font-bold mb-1">Total ARR Prospectado</span>
            <div className="text-2xl font-bold text-huboo-blue">
              {isLoadingData ? <Skeleton className="h-8 w-24 mx-auto" /> : `${totalARR.toLocaleString()}€`}
            </div>
            <span className="text-[10px] text-green-500 font-medium mt-1">Suma real de base de datos</span>
          </Card>

          <Card className="col-span-12 md:col-span-4 border-bento-border shadow-none flex flex-col justify-center text-center p-6">
            <span className="text-[10px] text-bento-text-muted uppercase tracking-widest font-bold mb-1">Marcas Analizadas</span>
            <div className="text-2xl font-bold text-huboo-blue">
              {isLoadingData ? <Skeleton className="h-8 w-12 mx-auto" /> : totalProspects}
            </div>
            <span className="text-[10px] text-bento-text-muted mt-1">KPI: 50 / Mes</span>
          </Card>

          <Card className="col-span-12 md:col-span-4 border-bento-border shadow-none flex flex-col justify-center text-center p-6">
            <span className="text-[10px] text-bento-text-muted uppercase tracking-widest font-bold mb-1">Conversión Estimada</span>
            <div className="text-2xl font-bold text-huboo-blue">18.4%</div>
            <span className="text-[10px] text-bento-text-muted mt-1">Model: Huboo-Logit-v2</span>
          </Card>

          {/* Upload & Analysis Section */}
          <Card className="col-span-12 lg:col-span-4 border-2 border-dashed border-bento-accent bg-blue-50/50 shadow-none flex flex-col items-center justify-center p-8 cursor-pointer hover:bg-blue-50 transition-colors" {...getRootProps()}>
            <input {...getInputProps()} />
            <div className="text-3xl mb-3 opacity-60">📸</div>
            <div className="text-center">
              <p className="font-bold text-sm">Subir Screenshot de Instagram</p>
              <p className="text-[10px] text-bento-text-muted mt-1">PNG, JPG o JPEG (Perfil/Bio)</p>
            </div>
            {isAnalyzing && (
              <div className="mt-4 flex flex-col items-center gap-1.5 text-xs text-bento-accent font-medium">
                <div className="flex items-center gap-2">
                  <Loader2 className="animate-spin" size={14} />
                  Analizando con Gemini (Prioridad)
                </div>
                <p className="text-[9px] opacity-60 text-center">Esperando respuesta de IA... Reintentando si es necesario.</p>
              </div>
            )}
          </Card>

          {/* Results Section */}
          <Card className="col-span-12 lg:col-span-8 border-bento-border shadow-none p-6">
            <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 mb-4">
              <Instagram size={14} className="text-huboo-blue" />
              Último Escaneo: Gemini AI Vision
            </h3>
            
            <AnimatePresence mode="wait">
              {!extractedData && !isAnalyzing ? (
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }}
                  className="h-[140px] flex items-center justify-center text-xs text-bento-text-muted border border-dashed rounded-lg"
                >
                  Esperando captura de pantalla...
                </motion.div>
              ) : isAnalyzing ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="p-3 bg-slate-50 rounded-lg space-y-2">
                      <Skeleton className="h-2 w-12" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  ))}
                </div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Marca</div>
                      <div className="font-bold text-sm">{safeRender(extractedData.brandName)}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Handle</div>
                      <div className="font-bold text-sm text-bento-accent">{safeRender(extractedData.username)}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Seguidores</div>
                      <div className="font-bold text-sm">{safeRender(extractedData.followers)}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Industria</div>
                      <div className="font-bold text-sm">{safeRender(extractedData.industry)}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">ARR Estimado</div>
                      <div className="font-bold text-sm text-huboo-blue">{calculateARR(parseFollowers(extractedData.followers)).toLocaleString()}€</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Contacto</div>
                      <div className="font-bold text-sm truncate">{safeRender(extractedData.contact)}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Teléfono</div>
                      <div className="font-bold text-sm truncate">{safeRender(extractedData.phone)}</div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button 
                      className="bg-huboo-blue hover:bg-huboo-blue/90 text-white font-bold text-xs px-6"
                      onClick={handleSave}
                      disabled={isSaving}
                    >
                      {isSaving ? <Loader2 className="animate-spin mr-2" size={14} /> : <CheckCircle2 className="mr-2" size={14} />}
                      Validar y Guardar en GSheets
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setExtractedData(null)}>Descartar</Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>

          {/* Table Section */}
          <Card className="col-span-12 border-bento-border shadow-none overflow-hidden">
            <div className="p-6 pb-0 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <TrendingUp size={14} className="text-huboo-blue" />
                Historial de Prospección Reciente
              </h3>
              <Button variant="ghost" size="sm" onClick={loadDashboardData} className="text-huboo-blue text-[10px] font-bold uppercase">
                Actualizar
              </Button>
            </div>
            <div className="p-0">
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow>
                    <TableHead className="text-[10px] uppercase font-bold text-bento-text-muted px-6">Fecha</TableHead>
                    <TableHead className="text-[10px] uppercase font-bold text-bento-text-muted px-6">Username</TableHead>
                    <TableHead className="text-[10px] uppercase font-bold text-bento-text-muted px-6">Seguidores</TableHead>
                    <TableHead className="text-[10px] uppercase font-bold text-bento-text-muted px-6">Sector</TableHead>
                    <TableHead className="text-[10px] uppercase font-bold text-bento-text-muted px-6">Teléfono</TableHead>
                    <TableHead className="text-[10px] uppercase font-bold text-bento-text-muted px-6 text-right">ARR Est.</TableHead>
                    <TableHead className="text-[10px] uppercase font-bold text-bento-text-muted px-6 text-center">Categoría</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingData ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="px-6"><Skeleton className="h-3 w-16" /></TableCell>
                        <TableCell className="px-6"><Skeleton className="h-3 w-24" /></TableCell>
                        <TableCell className="px-6"><Skeleton className="h-3 w-12" /></TableCell>
                        <TableCell className="px-6"><Skeleton className="h-3 w-20" /></TableCell>
                        <TableCell className="px-6"><Skeleton className="h-3 w-16 ml-auto" /></TableCell>
                        <TableCell className="px-6"><Skeleton className="h-6 w-24 mx-auto rounded-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : lastProspects.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-xs text-bento-text-muted">
                        No hay registros todavía.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lastProspects.map((prospect, index) => {
                      const arrValue = parseFloat(prospect.ARR?.replace(/[€$,]/g, '') || '0');
                      const isHigh = arrValue > HIGH_POTENTIAL_THRESHOLD;
                      return (
                        <TableRow key={index} className="hover:bg-slate-50/50 transition-colors border-b border-bento-border last:border-0">
                          <TableCell className="text-xs px-6">{prospect.Date}</TableCell>
                          <TableCell className="text-xs font-bold text-bento-accent px-6">{prospect.Username}</TableCell>
                          <TableCell className="text-xs px-6">{prospect.Followers}</TableCell>
                          <TableCell className="text-xs px-6">{prospect.Sector}</TableCell>
                          <TableCell className="text-xs px-6">{prospect.Phone || 'N/A'}</TableCell>
                          <TableCell className="text-xs font-bold text-huboo-blue px-6 text-right">{prospect.ARR}</TableCell>
                          <TableCell className="px-6 text-center">
                            <span className={`
                              inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight
                              ${isHigh ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}
                            `}>
                              {isHigh ? 'High Potential' : 'Mid Market'}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>

        {/* Footer Info */}
        <div className="mt-6 flex items-center justify-center gap-4 text-[10px] text-bento-text-muted font-medium">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            GSheets Connected
          </div>
          <div className="w-1 h-1 rounded-full bg-slate-300" />
          <div>Gemini AI Vision v2.0</div>
          <div className="w-1 h-1 rounded-full bg-slate-300" />
          <div>Formula: Segs × 2.15€</div>
        </div>
      </main>
    </div>
  );
}

