// xlsx wird nur beim Import und Export von Excel-Dateien gebraucht, macht aber
// den Löwenanteil des Bundles aus. Statt es beim Seitenaufruf mitzuladen,
// holen wir es erst, wenn tatsächlich eine Datei gelesen oder geschrieben wird.
//
// Verwendung:  const XLSX = await ladeXLSX();
const ladeXLSX = () => import('xlsx');

export { ladeXLSX };
