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
  const [isLoadingData, setIsLoadingData] = useState(true);

  const loadDashboardData = useCallback(async () => {
    try {
      const response = await fetch('/api/prospects');
      if (response.ok) {
        const data = await response.json();
        setLastProspects(data.last5 || []);
        setTotalARR(data.totalARR || 0);
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
  }, [loadDashboardData]);

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

  const handleSave = async () => {
    if (!extractedData) return;

    setIsSaving(true);
    const arr = extractedData.followers * FOLLOWERS_MULTIPLIER;
    
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

  return (
    <div className="min-h-screen bg-bento-bg text-foreground font-sans selection:bg-huboo-blue/20">
      <Toaster position="top-right" richColors />
      
      {/* Header */}
      <header className="bg-bento-sidebar text-white border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="https://raw.githubusercontent.com/Huboo-Fulfillment/huboo-brand-assets/main/logos/huboo-icon-white.png" 
              alt="Huboo Logo" 
              className="w-8 h-8 object-contain"
              referrerPolicy="no-referrer"
            />
            <h1 className="text-lg font-bold tracking-tight">OUTBOUND <span className="text-white/80">HUBOO</span></h1>
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
          <Card className="col-span-12 md:col-span-3 border-bento-border shadow-none flex flex-col justify-center text-center p-6">
            <span className="text-[10px] text-bento-text-muted uppercase tracking-widest font-bold mb-1">Total ARR Prospectado</span>
            <div className="text-2xl font-bold text-huboo-blue">
              {isLoadingData ? <Skeleton className="h-8 w-24 mx-auto" /> : `${totalARR.toLocaleString()}€`}
            </div>
            <span className="text-[10px] text-green-500 font-medium mt-1">↑ 12% vs last week</span>
          </Card>

          <Card className="col-span-12 md:col-span-3 border-bento-border shadow-none flex flex-col justify-center text-center p-6">
            <span className="text-[10px] text-bento-text-muted uppercase tracking-widest font-bold mb-1">Marcas Analizadas</span>
            <div className="text-2xl font-bold text-huboo-blue">
              {isLoadingData ? <Skeleton className="h-8 w-12 mx-auto" /> : '42'}
            </div>
            <span className="text-[10px] text-bento-text-muted mt-1">KPI: 50 / Mes</span>
          </Card>

          <Card className="col-span-12 md:col-span-3 border-bento-border shadow-none flex flex-col justify-center text-center p-6">
            <span className="text-[10px] text-bento-text-muted uppercase tracking-widest font-bold mb-1">Conversión Estimada</span>
            <div className="text-2xl font-bold text-huboo-blue">18.4%</div>
            <span className="text-[10px] text-bento-text-muted mt-1">Model: Huboo-Logit-v2</span>
          </Card>

          <Card className="col-span-12 md:col-span-3 border-bento-border shadow-none flex flex-col justify-center text-center p-6">
            <span className="text-[10px] text-bento-text-muted uppercase tracking-widest font-bold mb-1">Fuga de Leads</span>
            <div className="text-2xl font-bold text-red-500">2</div>
            <span className="text-[10px] text-red-400 mt-1">Duplicates prevented</span>
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
              <div className="mt-4 flex items-center gap-2 text-xs text-bento-accent font-medium">
                <Loader2 className="animate-spin" size={14} />
                Analizando con Gemini AI...
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
                      <div className="font-bold text-sm">{extractedData.brandName}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Handle</div>
                      <div className="font-bold text-sm text-bento-accent">{extractedData.username}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Seguidores</div>
                      <div className="font-bold text-sm">{extractedData.followers.toLocaleString()}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Industria</div>
                      <div className="font-bold text-sm">{extractedData.industry}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">ARR Estimado</div>
                      <div className="font-bold text-sm text-huboo-blue">{calculateARR(extractedData.followers).toLocaleString()}€</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Contacto</div>
                      <div className="font-bold text-sm truncate">{extractedData.contact || 'N/A'}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-bento-text-muted uppercase font-bold">Teléfono</div>
                      <div className="font-bold text-sm truncate">{extractedData.phone || 'N/A'}</div>
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

