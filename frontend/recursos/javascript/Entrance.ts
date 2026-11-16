import type { ChavePersonagem } from './componentes/login/Personagens';

const portal = document.querySelector<HTMLElement>('[data-entrance-portal]');

function ehChavePersonagem(valor: unknown): valor is ChavePersonagem {
  return valor === 'bene' || valor === 'leonardo' || valor === 'jeff' || valor === 'wolftheus';
}

if (portal) {
  const loginForm = portal.querySelector<HTMLFormElement>('[data-login-form]');
  const feedback = portal.querySelector<HTMLElement>('[data-login-feedback]');
  const mensagem = feedback?.querySelector<HTMLElement>('[data-login-message]');
  const guestLink = portal.querySelector<HTMLAnchorElement>('[data-guest-access]');
  const portalWindow = portal.querySelector<HTMLElement>('.portal-window');
  const submitButton = loginForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const labelButton = submitButton?.querySelector('span');

  function mostrarErro(texto: string): void {
    if (!feedback) return;
    if (mensagem) mensagem.textContent = texto;
    feedback.hidden = false;
    feedback.classList.remove('login-feedback--shown');
    void feedback.offsetWidth;
    feedback.classList.add('login-feedback--shown');
  }

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitButton?.disabled || portal.classList.contains('is-alien-recognized')) return;

    const userField = loginForm.elements.namedItem('visitor-name');
    const passField = loginForm.elements.namedItem('visitor-password');
    const usuario = userField instanceof HTMLInputElement ? userField.value.trim() : '';
    const senha = passField instanceof HTMLInputElement ? passField.value : '';

    if (feedback) feedback.hidden = true;
    if (submitButton) submitButton.disabled = true;
    if (labelButton) labelButton.textContent = 'Verificando acesso...';

    try {
      const resposta = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ usuario, senha }),
      });
      const dados: unknown = await resposta.json();
      const resultado = dados && typeof dados === 'object'
        ? dados as { ok?: unknown; chave?: unknown }
        : null;

      if (resposta.ok && resultado?.ok === true && ehChavePersonagem(resultado.chave)) {
        // A resposta do servidor definiu um cookie HttpOnly. Não guardamos tokens no JS.
        if (passField instanceof HTMLInputElement) passField.value = '';
        if (feedback) feedback.hidden = true;
        portal.classList.add('is-alien-recognized');
        if (labelButton) labelButton.textContent = 'Acesso reconhecido';

        const destino = `/login?tema=hibrido&personagem=${encodeURIComponent(resultado.chave)}`;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          window.location.assign(destino);
        } else {
          window.setTimeout(() => window.location.assign(destino), 560);
        }
        return;
      }

      loginForm.reset();

      if (resposta.status === 401) {
        mostrarErro('Usuário ou senha incorretos, essa conta não existe.');
      } else if (resposta.status === 429) {
        mostrarErro(
          'Muitas tentativas de acesso. Aguarde cerca de um minuto antes de tentar novamente.'
        );
      } else {
        mostrarErro('Não foi possível verificar o acesso agora. Tente novamente.');
      }
    } catch {
      mostrarErro('Sem conexão com o sistema de acesso. Tente novamente.');
    } finally {
      if (!portal.classList.contains('is-alien-recognized')) {
        if (submitButton) submitButton.disabled = false;
        if (labelButton) labelButton.textContent = 'Solicitar acesso';
      }
    }
  });

  guestLink?.addEventListener('click', (event) => {
    // Preserva atalhos do navegador e abertura em nova aba.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    // Sem animação para pessoas que preferem movimento reduzido.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    event.preventDefault();
    if (portal.classList.contains('is-entering')) return;

    portal.classList.add('is-entering');
    guestLink.setAttribute('aria-disabled', 'true');

    let navegou = false;
    const navegar = () => {
      if (navegou) return;
      navegou = true;
      window.location.assign(guestLink.href);
    };

    portalWindow?.addEventListener('animationend', (eventoAnimacao) => {
      if (eventoAnimacao.target === portalWindow && eventoAnimacao.animationName === 'portalFallAway') {
        navegar();
      }
    });
    window.setTimeout(navegar, 1700);
  });
}

// Restaura os botões caso a pessoa volte usando o histórico do navegador.
window.addEventListener('pageshow', () => {
  portal?.classList.remove('is-entering', 'is-alien-recognized');
  portal?.querySelector('[data-guest-access]')?.removeAttribute('aria-disabled');
  const botao = portal?.querySelector<HTMLButtonElement>('[data-login-form] button[type="submit"]');
  if (botao) botao.disabled = false;
  const texto = botao?.querySelector('span');
  if (texto) texto.textContent = 'Solicitar acesso';
});
