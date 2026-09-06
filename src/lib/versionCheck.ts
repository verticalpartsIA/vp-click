// Deploy é estático (build sobrescreve os arquivos direto no servidor, sem
// invalidação de CDN/versionamento) — uma aba deixada aberta pode continuar
// rodando o bundle antigo por horas/dias depois de uma atualização. Este
// módulo verifica periodicamente `version.json` (gerado a cada build pelo
// plugin em vite.config.ts) e avisa o usuário quando uma versão mais nova
// foi publicada, sem forçar o reload (evita perder algo que a pessoa esteja
// digitando).
//
// O aviso é entregue via callback (NotificationBanner do chamador), não
// mais como toast: um toast com duration:Infinity já causou um bug real
// (achado de QA, ver histórico) de cobrir o botão "+ Criar" — um toast é
// pensado pra ser transitório e flutuar por cima do conteúdo; a mensagem
// "atualize a página" precisa persistir e não deveria competir por espaço
// com o resto da UI. Padrão GOV.UK: "Notification banner" pra avisos
// importantes e persistentes, "toast" (não-GOV.UK, mas equivalente ao que
// já usávamos) só pra confirmações rápidas de uma ação.
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const FIRST_CHECK_DELAY_MS = 15 * 1000; // dá um tempo antes da primeira checagem
const DISPLAY_TIME_ZONE = 'America/Sao_Paulo';

// Guarda no localStorage (compartilhado entre abas da mesma origem, e
// sobrevive a um remount acidental do componente) qual buildTime já foi
// avisado — sem isso, quem tem mais de uma aba aberta do site vê o mesmo
// aviso "loopar" de aba em aba (cada aba tem sua própria variável `notified`
// em memória, mas todas comparam contra o mesmo version.json).
const NOTIFIED_BUILD_KEY = 'vp_version_notified_build';

function alreadyNotified(buildTime: string): boolean {
  try {
    return localStorage.getItem(NOTIFIED_BUILD_KEY) === buildTime;
  } catch {
    return false;
  }
}

function markNotified(buildTime: string): void {
  try {
    localStorage.setItem(NOTIFIED_BUILD_KEY, buildTime);
  } catch {
    // localStorage indisponível (modo privado etc.) — sem persistência,
    // mas a checagem desta aba continua funcionando normalmente.
  }
}

interface VersionInfo {
  buildTime: string;
  commit: string;
}

function formatUpdateMessage(buildTime: string): string {
  const d = new Date(buildTime);
  if (isNaN(d.getTime())) return 'Este site foi atualizado.';
  const date = d.toLocaleDateString('pt-BR', { timeZone: DISPLAY_TIME_ZONE });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TIME_ZONE });
  return `Este site foi atualizado em ${date} às ${time}h`;
}

// Usado pela Sidebar pra mostrar "Última atualização: DD/MM/AA HH:MMh" —
// data/hora do build desta aba (__APP_BUILD_TIME__), não a mais recente
// publicada no servidor (essa é a que o aviso de startVersionCheck cobre).
export function formatBuildTimeShort(buildTime: string): string | null {
  const d = new Date(buildTime);
  if (isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: DISPLAY_TIME_ZONE });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TIME_ZONE });
  return `${date} ${time}h`;
}

export interface UpdateNotice {
  message: string;
  description: string;
}

// `onUpdateAvailable` é chamado quando uma versão nova é detectada; o
// chamador decide como exibir (App.tsx renderiza um NotificationBanner
// persistente — ver comentário no topo do arquivo).
export function startVersionCheck(onUpdateAvailable: (notice: UpdateNotice) => void): () => void {
  let notified = false;
  const currentBuildTime = __APP_BUILD_TIME__;

  const check = async () => {
    if (notified) return;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const info: VersionInfo = await res.json();
      if (info.buildTime && info.buildTime !== currentBuildTime) {
        if (alreadyNotified(info.buildTime)) {
          notified = true;
          return;
        }
        notified = true;
        markNotified(info.buildTime);
        onUpdateAvailable({
          message: formatUpdateMessage(info.buildTime),
          description: 'Atualize a página para usar a versão mais recente.',
        });
      }
    } catch {
      // Rede instável/offline — tenta de novo no próximo ciclo, sem incomodar.
    }
  };

  const firstCheckTimer = setTimeout(check, FIRST_CHECK_DELAY_MS);
  const interval = setInterval(check, CHECK_INTERVAL_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') check();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', check);

  return () => {
    clearTimeout(firstCheckTimer);
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', check);
  };
}
