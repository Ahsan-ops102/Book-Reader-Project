let preparation;
export let offlineShellStatus = 'Offline app cache has not been checked yet.';
function report(message) {
  offlineShellStatus = message;
  window.dispatchEvent(new Event('reader_offline_status'));
  return message;
}
export function prepareOfflineShell() {
  if (!import.meta.env.PROD) return Promise.resolve(report('Offline reload requires a production build. Downloads can still be kept on this device.'));
  if (!('serviceWorker' in navigator)) return Promise.resolve(report('This browser does not support offline app caching. Keep this tab open to read downloaded books.'));
  return preparation ||= (async () => {
    let timer;
    try {
      await navigator.serviceWorker.register('/sw.js');
      await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('app cache did not become ready')),15000);})]);
      return report('The app is ready for offline reload in this signed-in tab. Download each book separately.');
    } catch (e) {
      preparation = null;
      console.warn('Offline app cache unavailable:',e.message);
      return report('Offline reload is unavailable in this browser. Downloaded files remain on this device; keep the current tab open.');
    } finally {clearTimeout(timer);}
  })();
}
