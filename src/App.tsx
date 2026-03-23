import React, { useState, useEffect, useRef } from 'react';
import { Calendar, RotateCcw, Info, Save, History, Trash2, ChevronRight, FileDown, Upload, Sparkles, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { GoogleGenAI, Type } from '@google/genai';

type TipoPlazo = 'Días' | 'Meses' | 'Años';
type Jurisdiccion = 'Civil' | 'Penal' | 'Contencioso-Administrativo' | 'Social' | 'Administrativo';

interface Condiciones {
  sabados: boolean;
  domingos: boolean;
  festivos: boolean;
  agosto: boolean;
  navidades: boolean;
}

interface CalculoHistorial {
  id: string;
  jurisdiccion: Jurisdiccion;
  plazo: string;
  tipoPlazo: TipoPlazo;
  fechaNotificacion: string;
  condiciones: Condiciones;
  festivosLocales: string[];
  resultado: Date;
  fechaCalculo: Date;
  esActoConciliacion?: boolean;
}

const defaultCondiciones: Record<Jurisdiccion, Condiciones> = {
  'Civil': { sabados: true, domingos: true, festivos: true, agosto: true, navidades: true },
  'Penal': { sabados: true, domingos: true, festivos: true, agosto: false, navidades: false },
  'Contencioso-Administrativo': { sabados: true, domingos: true, festivos: true, agosto: true, navidades: false },
  'Social': { sabados: true, domingos: true, festivos: true, agosto: true, navidades: false },
  'Administrativo': { sabados: true, domingos: true, festivos: true, agosto: false, navidades: false },
};

export default function App() {
  const [jurisdiccion, setJurisdiccion] = useState<Jurisdiccion>('Civil');
  const [plazo, setPlazo] = useState<string>('');
  const [tipoPlazo, setTipoPlazo] = useState<TipoPlazo>('Días');
  const [fechaNotificacion, setFechaNotificacion] = useState<string>('');
  const [condiciones, setCondiciones] = useState<Condiciones>(defaultCondiciones['Civil']);
  const [festivosLocales, setFestivosLocales] = useState<string[]>([]);
  const [nuevoFestivo, setNuevoFestivo] = useState<string>('');
  const [resultado, setResultado] = useState<Date | null>(null);
  const [esActoConciliacion, setEsActoConciliacion] = useState<boolean>(false);
  
  const [logoBase64, setLogoBase64] = useState<string | null>(() => localStorage.getItem('corporateLogo'));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [historial, setHistorial] = useState<CalculoHistorial[]>(() => {
    const saved = localStorage.getItem('historialPlazos');
    if (saved) {
      try {
        return JSON.parse(saved).map((h: any) => ({
          ...h,
          resultado: new Date(h.resultado),
          fechaCalculo: new Date(h.fechaCalculo)
        }));
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('historialPlazos', JSON.stringify(historial));
  }, [historial]);

  useEffect(() => {
    setCondiciones(defaultCondiciones[jurisdiccion]);
    if (jurisdiccion !== 'Social') {
      setEsActoConciliacion(false);
    }
  }, [jurisdiccion]);

  useEffect(() => {
    calcularPlazo();
  }, [plazo, tipoPlazo, fechaNotificacion, condiciones, festivosLocales]);

  const getViernesSanto = (year: number): string => {
    const f = Math.floor;
    const G = year % 19;
    const C = f(year / 100);
    const H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30;
    const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11));
    const J = (year + f(year / 4) + I + 2 - C + f(C / 4)) % 7;
    const L = I - J;
    const month = 3 + f((L + 40) / 44);
    const day = L + 28 - 31 * f(month / 4);
    
    const easter = new Date(year, month - 1, day);
    easter.setDate(easter.getDate() - 2); // Viernes Santo
    
    return `${easter.getMonth() + 1}-${easter.getDate()}`;
  };

  const isHoliday = (date: Date): boolean => {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();
    const dateString = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const monthDayString = `${month}-${day}`;

    // Festivos nacionales fijos en España
    const fixedHolidays = [
      '1-1', '1-6', '5-1', '8-15', '10-12', '11-1', '12-6', '12-8', '12-25'
    ];
    if (fixedHolidays.includes(monthDayString)) return true;

    // Festivo variable (Viernes Santo)
    if (monthDayString === getViernesSanto(year)) return true;

    // Festivos locales/autonómicos
    if (festivosLocales.includes(dateString)) return true;

    return false;
  };

  const isNonWorking = (date: Date, conds: Condiciones): boolean => {
    const dayOfWeek = date.getDay();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    if (conds.sabados && dayOfWeek === 6) return true;
    if (conds.domingos && dayOfWeek === 0) return true;
    if (conds.festivos && isHoliday(date)) return true;
    if (conds.agosto && month === 8) return true;
    if (conds.navidades && ((month === 12 && day >= 24) || (month === 1 && day <= 6))) return true;

    return false;
  };

  const calcularPlazo = () => {
    if (!plazo || isNaN(Number(plazo)) || !fechaNotificacion) {
      setResultado(null);
      return;
    }

    const numPlazo = parseInt(plazo, 10);
    const [year, month, day] = fechaNotificacion.split('-').map(Number);
    let currentDate = new Date(year, month - 1, day);

    if (tipoPlazo === 'Días') {
      let daysAdded = 0;
      while (daysAdded < numPlazo) {
        currentDate.setDate(currentDate.getDate() + 1);
        if (!isNonWorking(currentDate, condiciones)) {
          daysAdded++;
        }
      }
    } else if (tipoPlazo === 'Meses') {
      const targetMonth = currentDate.getMonth() + numPlazo;
      const expectedMonth = targetMonth % 12;
      currentDate.setMonth(targetMonth);
      // Si el mes resultante no coincide (ej. 31 Ene + 1 mes -> 3 Mar), ajustamos al último día del mes esperado
      if (currentDate.getMonth() !== (expectedMonth < 0 ? expectedMonth + 12 : expectedMonth)) {
        currentDate.setDate(0);
      }
    } else if (tipoPlazo === 'Años') {
      currentDate.setFullYear(currentDate.getFullYear() + numPlazo);
    }

    // Comprobación para ver si la fecha resultante es un festivo según las condiciones. Si lo es, aplica el día de gracia.
    while (isNonWorking(currentDate, condiciones)) {
      currentDate.setDate(currentDate.getDate() + 1);
    }

    setResultado(currentDate);
  };

  const handleLimpiar = () => {
    setJurisdiccion('Civil');
    setPlazo('');
    setTipoPlazo('Días');
    setFechaNotificacion('');
    setCondiciones(defaultCondiciones['Civil']);
    setFestivosLocales([]);
    setNuevoFestivo('');
    setResultado(null);
    setEsActoConciliacion(false);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setLogoBase64(base64);
        localStorage.setItem('corporateLogo', base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeLogo = () => {
    setLogoBase64(null);
    localStorage.removeItem('corporateLogo');
  };

  const analizarConIA = async () => {
    if (!aiText.trim()) return;
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Analiza el siguiente texto de una notificación judicial o administrativa y extrae los datos para calcular el plazo.
        
        Texto: "${aiText}"`,
        config: {
          systemInstruction: "Eres un asistente legal experto en derecho español. Extrae la jurisdicción, el plazo numérico, el tipo de plazo y la fecha de notificación si se menciona. Si no se menciona la fecha, déjala vacía.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              jurisdiccion: {
                type: Type.STRING,
                description: "La jurisdicción aplicable: 'Civil', 'Penal', 'Contencioso-Administrativo', 'Social' o 'Administrativo'. Si no estás seguro, usa 'Civil'.",
              },
              plazo: {
                type: Type.STRING,
                description: "El número del plazo (ej. '20').",
              },
              tipoPlazo: {
                type: Type.STRING,
                description: "El tipo de plazo: 'Días', 'Meses' o 'Años'.",
              },
              fechaNotificacion: {
                type: Type.STRING,
                description: "La fecha de notificación en formato YYYY-MM-DD. Si no se indica, devuelve un string vacío.",
              }
            },
            required: ["jurisdiccion", "plazo", "tipoPlazo", "fechaNotificacion"]
          }
        }
      });

      if (response.text) {
        const data = JSON.parse(response.text);
        if (['Civil', 'Penal', 'Contencioso-Administrativo', 'Social', 'Administrativo'].includes(data.jurisdiccion)) {
          setJurisdiccion(data.jurisdiccion as Jurisdiccion);
        }
        if (data.plazo) setPlazo(data.plazo);
        if (['Días', 'Meses', 'Años'].includes(data.tipoPlazo)) {
          setTipoPlazo(data.tipoPlazo as TipoPlazo);
        }
        if (data.fechaNotificacion) {
          setFechaNotificacion(data.fechaNotificacion);
        }
        setIsAiModalOpen(false);
        setAiText('');
      }
    } catch (error) {
      console.error("Error al analizar con IA:", error);
      alert("Hubo un error al analizar el texto. Por favor, inténtalo de nuevo.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const guardarEnHistorial = () => {
    if (!resultado || !plazo || !fechaNotificacion) return;
    const nuevoCalculo: CalculoHistorial = {
      id: Date.now().toString(),
      jurisdiccion,
      plazo,
      tipoPlazo,
      fechaNotificacion,
      condiciones,
      festivosLocales,
      resultado,
      fechaCalculo: new Date(),
      esActoConciliacion
    };
    setHistorial([nuevoCalculo, ...historial]);
  };

  const cargarHistorial = (item: CalculoHistorial) => {
    setJurisdiccion(item.jurisdiccion);
    setPlazo(item.plazo);
    setTipoPlazo(item.tipoPlazo);
    setFechaNotificacion(item.fechaNotificacion);
    setCondiciones(item.condiciones);
    setFestivosLocales(item.festivosLocales || []);
    setEsActoConciliacion(item.esActoConciliacion || false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const eliminarHistorial = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistorial(historial.filter(h => h.id !== id));
  };

  const formatDate = (date: Date) => {
    const formatted = date.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  };

  const exportarPDF = async () => {
    if (!resultado || !fechaNotificacion || !plazo) return;

    const pdf = new jsPDF();
    
    // Header
    pdf.setFillColor(30, 64, 175); // #1e40af
    pdf.rect(0, 0, 210, 40, 'F');
    
    if (logoBase64) {
      try {
        pdf.addImage(logoBase64, 'JPEG', 15, 5, 50, 30);
      } catch (e) {
        console.error("Error adding logo to PDF", e);
      }
    }
    
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(20);
    pdf.text('Informe de Cálculo de Plazos', 70, 25);
    
    // Content
    pdf.setTextColor(40, 40, 40);
    pdf.setFontSize(12);
    
    let y = 60;
    const addRow = (label: string, value: string) => {
      pdf.setFont('helvetica', 'bold');
      pdf.text(label, 20, y);
      pdf.setFont('helvetica', 'normal');
      pdf.text(value, 80, y);
      y += 10;
    };

    addRow('Jurisdicción:', jurisdiccion);
    addRow('Plazo:', `${plazo} ${tipoPlazo}`);
    addRow('Fecha de notificación:', new Date(fechaNotificacion).toLocaleDateString('es-ES'));
    
    y += 5;
    pdf.setDrawColor(200, 200, 200);
    pdf.line(20, y, 190, y);
    y += 15;

    pdf.setFont('helvetica', 'bold');
    pdf.text('Condiciones aplicadas:', 20, y);
    y += 10;
    pdf.setFont('helvetica', 'normal');
    
    const conds = [];
    if (condiciones.sabados) conds.push('Sábados inhábiles');
    if (condiciones.domingos) conds.push('Domingos inhábiles');
    if (condiciones.festivos) conds.push('Festivos nacionales inhábiles');
    if (condiciones.agosto) conds.push('Agosto inhábil');
    if (condiciones.navidades) conds.push('Navidades inhábiles (24 dic - 6 ene)');
    
    conds.forEach(c => {
      pdf.text(`• ${c}`, 25, y);
      y += 8;
    });

    if (festivosLocales.length > 0) {
      y += 5;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Festivos locales/autonómicos:', 20, y);
      y += 10;
      pdf.setFont('helvetica', 'normal');
      festivosLocales.forEach(f => {
        pdf.text(`• ${new Date(f).toLocaleDateString('es-ES')}`, 25, y);
        y += 8;
      });
    }

    y += 10;
    pdf.setDrawColor(200, 200, 200);
    pdf.line(20, y, 190, y);
    y += 15;

    // Result
    pdf.setFillColor(236, 253, 245); // emerald-50
    pdf.setDrawColor(167, 243, 208); // emerald-200
    pdf.rect(20, y, 170, 40, 'FD');

    pdf.setTextColor(6, 78, 59); // emerald-900
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Fecha de vencimiento:', 30, y + 15);
    
    pdf.setFontSize(18);
    pdf.text(formatDate(resultado), 30, y + 25);

    // Día de gracia
    if (!esActoConciliacion) {
      let nextDay = new Date(resultado);
      do {
        nextDay.setDate(nextDay.getDate() + 1);
      } while (isNonWorking(nextDay, condiciones));
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(4, 120, 87); // emerald-700
      pdf.text(`Día de gracia: Hasta las 15:00h del ${formatDate(nextDay)}`, 30, y + 35);
    }

    // Footer
    pdf.setTextColor(100, 100, 100);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('MOREY SALVA CONSULTING, S.L.P.', 105, 280, { align: 'center' });
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Abogados - Graduados Sociales - Técnicos Tributarios', 105, 285, { align: 'center' });

    pdf.save(`Plazo_${jurisdiccion}_${new Date(fechaNotificacion).toLocaleDateString('es-ES').replace(/\//g, '-')}.pdf`);
  };

  return (
    <div className="min-h-screen bg-stone-100 py-10 px-4 font-sans text-stone-800 flex flex-col items-center relative">
      <div className="w-full max-w-3xl bg-white rounded-xl shadow-lg overflow-hidden h-fit shrink-0">
        {/* Header */}
        <div className="bg-[#1e40af] text-white p-6 flex flex-col sm:flex-row items-center gap-6 relative">
          <div className="bg-white p-2 rounded-lg shadow-sm h-20 w-48 flex items-center justify-center shrink-0 relative group">
            {logoBase64 ? (
              <>
                <img 
                  src={logoBase64} 
                  alt="Morey Salvá Consulting" 
                  className="max-h-full max-w-full object-contain"
                />
                <button 
                  onClick={removeLogo}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                  title="Eliminar logo"
                >
                  <X className="w-3 h-3" />
                </button>
              </>
            ) : (
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center text-stone-400 hover:text-[#1e40af] transition-colors w-full h-full"
              >
                <Upload className="w-6 h-6 mb-1" />
                <span className="text-xs font-medium text-center leading-tight">Subir Logo<br/>(JPG/PNG)</span>
              </button>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleLogoUpload} 
              accept="image/*" 
              className="hidden" 
            />
          </div>
          <div className="text-center sm:text-left flex-1">
            <h1 className="text-2xl font-bold tracking-wide">Cálculo de Plazos Procesales</h1>
            <p className="text-blue-100 text-sm font-medium mt-1">Área Jurídica</p>
          </div>
          <button
            onClick={() => setIsAiModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-sm font-medium border border-white/20 whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            Rellenar con IA
          </button>
        </div>

        <div className="p-8 space-y-8">
          {/* Form Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 md:col-span-2">
              <label className="block text-sm font-medium text-stone-700">Jurisdicción</label>
              <select
                value={jurisdiccion}
                onChange={(e) => setJurisdiccion(e.target.value as Jurisdiccion)}
                className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#b4863a] focus:border-[#b4863a] outline-none transition-all bg-white"
              >
                <option value="Civil">Civil</option>
                <option value="Penal">Penal</option>
                <option value="Contencioso-Administrativo">Contencioso-Administrativo</option>
                <option value="Social">Social</option>
                <option value="Administrativo">Administrativo</option>
              </select>
              {jurisdiccion === 'Social' && (
                <label className="flex items-center space-x-2 mt-2 text-sm text-stone-600">
                  <input
                    type="checkbox"
                    checked={esActoConciliacion}
                    onChange={(e) => setEsActoConciliacion(e.target.checked)}
                    className="rounded text-[#b4863a] focus:ring-[#b4863a]"
                  />
                  <span>Acto de conciliación (SMAC, TAMIB o equivalente) - No aplica día de gracia</span>
                </label>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-stone-700">Plazo</label>
              <input
                type="number"
                min="1"
                placeholder="Ej: 20"
                value={plazo}
                onChange={(e) => setPlazo(e.target.value)}
                className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#b4863a] focus:border-[#b4863a] outline-none transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-stone-700">Tipo de plazo</label>
              <select
                value={tipoPlazo}
                onChange={(e) => setTipoPlazo(e.target.value as TipoPlazo)}
                className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#b4863a] focus:border-[#b4863a] outline-none transition-all bg-white"
              >
                <option value="Días">Días</option>
                <option value="Meses">Meses</option>
                <option value="Años">Años</option>
              </select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="block text-sm font-medium text-stone-700">Fecha de notificación</label>
              <div className="relative">
                <input
                  type="date"
                  value={fechaNotificacion}
                  onChange={(e) => setFechaNotificacion(e.target.value)}
                  className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#b4863a] focus:border-[#b4863a] outline-none transition-all"
                />
              </div>
            </div>
          </div>

          {/* Condiciones inhábiles */}
          <div className="bg-stone-50 p-6 rounded-xl border border-stone-200">
            <h3 className="text-sm font-semibold text-stone-700 mb-4">Condiciones inhábiles</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={condiciones.sabados}
                    onChange={(e) => setCondiciones({ ...condiciones, sabados: e.target.checked })}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-stone-400 rounded-full peer-checked:bg-[#1e40af] peer-checked:border-[#1e40af] transition-colors flex items-center justify-center">
                    <svg className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <span className="text-stone-700 group-hover:text-stone-900 transition-colors">Sábados</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={condiciones.domingos}
                    onChange={(e) => setCondiciones({ ...condiciones, domingos: e.target.checked })}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-stone-400 rounded-full peer-checked:bg-[#1e40af] peer-checked:border-[#1e40af] transition-colors flex items-center justify-center">
                    <svg className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <span className="text-stone-700 group-hover:text-stone-900 transition-colors">Domingos</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={condiciones.festivos}
                    onChange={(e) => setCondiciones({ ...condiciones, festivos: e.target.checked })}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-stone-400 rounded-full peer-checked:bg-[#1e40af] peer-checked:border-[#1e40af] transition-colors flex items-center justify-center">
                    <svg className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <span className="text-stone-700 group-hover:text-stone-900 transition-colors">Festivos nacionales</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={condiciones.agosto}
                    onChange={(e) => setCondiciones({ ...condiciones, agosto: e.target.checked })}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-stone-400 rounded-full peer-checked:bg-[#1e40af] peer-checked:border-[#1e40af] transition-colors flex items-center justify-center">
                    <svg className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <span className="text-stone-700 group-hover:text-stone-900 transition-colors">Agosto</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group sm:col-span-2">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={condiciones.navidades}
                    onChange={(e) => setCondiciones({ ...condiciones, navidades: e.target.checked })}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-stone-400 rounded-full peer-checked:bg-[#1e40af] peer-checked:border-[#1e40af] transition-colors flex items-center justify-center">
                    <svg className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <span className="text-stone-700 group-hover:text-stone-900 transition-colors">Del 24 de diciembre al 6 de enero</span>
              </label>
            </div>
          </div>

          {/* Festivos locales */}
          <div className="bg-stone-50 p-6 rounded-xl border border-stone-200">
            <h3 className="text-sm font-semibold text-stone-700 mb-4">Festivos autonómicos y locales</h3>
            <div className="flex gap-3 mb-4">
              <input
                type="date"
                value={nuevoFestivo}
                onChange={(e) => setNuevoFestivo(e.target.value)}
                className="flex-1 p-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#b4863a] focus:border-[#b4863a] outline-none transition-all"
              />
              <button
                onClick={() => {
                  if (nuevoFestivo && !festivosLocales.includes(nuevoFestivo)) {
                    setFestivosLocales([...festivosLocales, nuevoFestivo].sort());
                    setNuevoFestivo('');
                  }
                }}
                className="px-4 py-2 bg-stone-200 text-stone-700 rounded-lg hover:bg-stone-300 transition-colors font-medium"
              >
                Añadir
              </button>
            </div>
            {festivosLocales.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {festivosLocales.map(festivo => (
                  <span key={festivo} className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-stone-200 rounded-full text-sm text-stone-600 shadow-sm">
                    {new Date(festivo).toLocaleDateString('es-ES')}
                    <button
                      onClick={() => setFestivosLocales(festivosLocales.filter(f => f !== festivo))}
                      className="text-stone-400 hover:text-red-500 transition-colors ml-1"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={handleLimpiar}
              className="flex items-center gap-2 px-5 py-2.5 border border-stone-300 rounded-lg text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition-colors font-medium"
            >
              <RotateCcw className="w-4 h-4" />
              Limpiar
            </button>
            <button
              onClick={guardarEnHistorial}
              disabled={!resultado}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1e40af] text-white rounded-lg hover:bg-[#1e3a8a] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              Guardar en historial
            </button>
            <button
              onClick={exportarPDF}
              disabled={!resultado}
              className="flex items-center gap-2 px-5 py-2.5 bg-stone-800 text-white rounded-lg hover:bg-stone-900 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
            >
              <FileDown className="w-4 h-4" />
              Exportar PDF
            </button>
          </div>

          {/* Result */}
          {resultado && (
            <div className="mt-8 p-6 bg-emerald-50 border border-emerald-200 rounded-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h3 className="text-emerald-800 font-semibold mb-2">Fecha de vencimiento:</h3>
              <p className="text-2xl font-bold text-emerald-900">
                {formatDate(resultado)}
              </p>
              {!esActoConciliacion && (
                <p className="text-emerald-700 text-sm mt-2">
                  Día de gracia: Hasta las 15:00h del día hábil siguiente ({formatDate(
                    (function() {
                      let nextDay = new Date(resultado);
                      do {
                        nextDay.setDate(nextDay.getDate() + 1);
                      } while (isNonWorking(nextDay, condiciones));
                      return nextDay;
                    })()
                  )})
                </p>
              )}
            </div>
          )}

          {/* Info */}
          <div className="bg-stone-100 rounded-xl p-5 flex gap-4 text-stone-600 text-sm border border-stone-200">
            <Info className="w-5 h-5 shrink-0 text-stone-400 mt-0.5" />
            <p className="leading-relaxed">
              La Ley confiere, en determinados casos, la posibilidad de habilitar días y horas inhábiles. El cómputo de plazos se rige por los Arts. 130-136 LEC, Art. 185 LOPJ y la Ley 39/2015 (procedimiento administrativo). El día de la notificación no se cuenta; el cómputo comienza al día siguiente. Este cálculo no incluye festivos autonómicos ni locales.
            </p>
          </div>

          {/* Footer */}
          <div className="bg-slate-50 border-t border-slate-200 p-6 text-center mt-4 rounded-b-xl">
            <h2 className="text-slate-800 font-bold tracking-wide">MOREY SALVA CONSULTING, S.L.P.</h2>
            <p className="text-slate-500 text-sm mt-1">Abogados - Graduados Sociales - Técnicos Tributarios</p>
          </div>
        </div>
      </div>

      {/* Historial Section */}
      {historial.length > 0 && (
        <div className="w-full max-w-3xl mt-8 bg-white rounded-xl shadow-lg overflow-hidden h-fit shrink-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-stone-100 border-b border-stone-200 p-4 flex items-center gap-3">
            <History className="w-5 h-5 text-stone-600" />
            <h2 className="text-lg font-semibold text-stone-800">Historial de Cálculos</h2>
          </div>
          <div className="divide-y divide-stone-100">
            {historial.map((item) => (
              <div
                key={item.id}
                onClick={() => cargarHistorial(item)}
                className="p-4 hover:bg-stone-50 cursor-pointer transition-colors flex items-center justify-between group"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-sm font-medium text-[#1e40af] bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100">
                      {item.jurisdiccion}
                    </span>
                    <span className="text-stone-800 font-semibold">
                      {item.plazo} {item.tipoPlazo}
                    </span>
                  </div>
                  <div className="text-sm text-stone-500 flex items-center gap-4">
                    <span>Notificación: {new Date(item.fechaNotificacion).toLocaleDateString('es-ES')}</span>
                    <span className="hidden sm:inline">•</span>
                    <span className="text-emerald-700 font-medium">Vence: {item.resultado.toLocaleDateString('es-ES')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => eliminarHistorial(item.id, e)}
                    className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    title="Eliminar del historial"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-stone-300 group-hover:text-[#1e40af] transition-colors" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Modal */}
      {isAiModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#1e40af] text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-300" />
                <h3 className="font-semibold">Analizar notificación con IA</h3>
              </div>
              <button onClick={() => setIsAiModalOpen(false)} className="text-white/70 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-stone-600">
                Pega el texto de la resolución o notificación judicial. Gemini extraerá automáticamente la jurisdicción, el plazo y la fecha.
              </p>
              <textarea
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder="Ej: Notificamos a las partes que disponen de 20 días hábiles para contestar a la demanda..."
                className="w-full h-40 p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#1e40af] focus:border-[#1e40af] outline-none resize-none text-sm"
              />
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setIsAiModalOpen(false)}
                  className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-lg transition-colors font-medium text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={analizarConIA}
                  disabled={isAnalyzing || !aiText.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-[#1e40af] text-white rounded-lg hover:bg-[#1e3a8a] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAnalyzing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Analizando...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Extraer datos
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
