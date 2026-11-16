
import { buscarPersonagem } from './Personagens';

const stage = document.querySelector<HTMLElement>('[data-alien-stage]');

if (stage) {
  const params = new URLSearchParams(window.location.search);
  const preview = params.get('preview') === '1';

  if (stage.dataset.mode === 'revelacao') {
    const personagem = buscarPersonagem(params.get('personagem'));
    stage.dataset.character = personagem.nome;

    const nome = stage.querySelector<HTMLElement>('[data-alien-character-name]');
    if (nome) nome.textContent = personagem.nome;

    const destino = stage.querySelector<HTMLAnchorElement>('[data-alien-zoom]');
    if (destino) destino.href = personagem.rota;
  }

  const phase = stage.querySelector<HTMLElement>('[data-alien-phase]');

  let navigating = false;
  let autoTimer: number | undefined;

  const reduced = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  function go(href: string, style: 'zoom' | 'fly') {
    if (navigating) return;

    navigating = true;

    if (autoTimer !== undefined) {
      window.clearTimeout(autoTimer);
      autoTimer = undefined;
    }

    if (phase) {
      phase.textContent =
        style === 'zoom'
          ? 'ABRINDO ÁREA INTERNA...'
          : 'TRANSFERÊNCIA EXTRATERRESTRE...';
    }

    if (reduced) {
      window.location.assign(href);
      return;
    }

    stage?.classList.add(
      style === 'zoom' ? 'is-zooming' : 'is-flying'
    );

    // Navegação única com fallback, sem depender de animationend.
    window.setTimeout(
      () => window.location.assign(href),
      style === 'zoom' ? 1000 : 1170
    );
  }

  async function sairComLogout(href: string): Promise<void> {
    if (navigating) return;

    navigating = true;

    // Impede que a transição automática interrompa o logout.
    if (autoTimer !== undefined) {
      window.clearTimeout(autoTimer);
      autoTimer = undefined;
    }

    if (phase) {
      phase.textContent = 'ENCERRANDO SESSÃO...';
    }

    try {
      const resposta = await fetch('/api/logout', {
        method: 'POST',
        credentials: 'same-origin'
      });

      if (!resposta.ok) {
        throw new Error(
          `Falha ao encerrar sessão: HTTP ${resposta.status}`
        );
      }

      // Sessão encerrada: libera a navegação animada.
      navigating = false;
      go(href, 'fly');

    } catch (erro) {
      navigating = false;

      if (phase) {
        phase.textContent = 'FALHA AO ENCERRAR SESSÃO';
      }

      console.error('H1: erro ao encerrar sessão.', erro);

      window.alert(
        'Não foi possível encerrar a sessão. Tente novamente.'
      );
    }
  }

  function scheduleAuto() {
    if (autoTimer !== undefined) {
      window.clearTimeout(autoTimer);
    }

    if (preview || stage?.dataset.mode !== 'revelacao') {
      return;
    }

    const link = stage.querySelector<HTMLAnchorElement>(
      '[data-alien-zoom]'
    );

    if (link) {
      autoTimer = window.setTimeout(
        () => go(link.href, 'zoom'),
        reduced ? 6500 : 7200
      );
    }
  }

  stage.addEventListener('click', (event) => {
    const target = event.target;

    if (!(target instanceof Element)) return;

    const link = target.closest<HTMLAnchorElement>(
      'a[data-alien-zoom], a[data-alien-fly], a.alien-status__exit'
    );

    if (!link) return;
    if (!(event instanceof MouseEvent)) return;

    // Preserva os atalhos nativos do navegador.
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      event.metaKey
    ) {
      return;
    }

    const url = new URL(link.href);

    if (url.origin !== window.location.origin) {
      return;
    }

    event.preventDefault();

    // As saídas encerram a sessão antes da navegação.
    const ehSaida =
      url.pathname === '/' &&
      (
        link.classList.contains('alien-video__back') ||
        link.classList.contains('alien-status__exit')
      );

    if (ehSaida) {
      void sairComLogout(link.href);
      return;
    }

    // Demais transições preservam o comportamento original.
    go(
      link.href,
      link.hasAttribute('data-alien-zoom') ? 'zoom' : 'fly'
    );
  });

  if (stage.dataset.mode === 'revelacao') {
    // Primeiro renderiza a fachada; depois abre as portas.
    window.setTimeout(() => {
      stage.dataset.open = 'true';
    }, 180);

    scheduleAuto();
  }
}
