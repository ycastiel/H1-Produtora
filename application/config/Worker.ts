type Chave = 'bene' | 'leonardo' | 'jeff' | 'wolftheus';
type Credencial = { usuario: string; senha: string };
type Credenciais = Record<Chave, Credencial>;
type Sessao = { v: 1; chave: Chave; iat: number; exp: number };


interface Ambiente {
  ASSETS: { fetch(request: Request): Promise<Response> };
  H1_LOGIN_CREDENTIALS: string;
  H1_SESSION_KEY: string;

  H1_LOGIN_LIMITER: {
    limit(opcoes: { key: string }): Promise<{ success: boolean }>;
  };
}


const CHAVES: Chave[] = ['bene', 'leonardo', 'jeff', 'wolftheus'];
const COOKIE = 'h1_sessao';
const SEGUNDOS_SESSAO = 30 * 60;
const encoder = new TextEncoder();

const rotas: Record<Chave, string> = {
  bene: '/login/Bene',
  leonardo: '/login/Leonardo',
  jeff: '/login/Jeff',
  wolftheus: '/login/Wolftheus',
};

function ehChave(valor: unknown): valor is Chave {
  return typeof valor === 'string' && CHAVES.some((chave) => chave === valor);
}

function normalizarUsuario(usuario: string): string {
  return usuario.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function json(dados: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function lerCredenciais(valor: string | undefined): Credenciais | null {
  try {
    const dados: unknown = JSON.parse(valor ?? '');
    if (typeof dados !== 'object' || dados === null || Array.isArray(dados)) return null;

    const registros = dados as Record<string, unknown>;

    for (const chave of CHAVES) {
      const registro = registros[chave];
      if (!registro || typeof registro !== 'object' || Array.isArray(registro)) return null;

      const credencial = registro as Record<string, unknown>;

      if (
        typeof credencial.usuario !== 'string' ||
        !credencial.usuario.trim() ||
        typeof credencial.senha !== 'string' ||
        !credencial.senha
      ) return null;
    }

    return registros as Credenciais;
  } catch {
    return null;
  }
}

async function chaveHmac(segredo: string | undefined): Promise<CryptoKey | null> {
  if (!segredo || segredo.length < 32) return null;

  return crypto.subtle.importKey(
    'raw',
    encoder.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function paraBase64Url(bytes: Uint8Array): string {
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);

  return btoa(binario)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function deBase64Url(texto: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(texto)) return null;

  try {
    const binario = atob(
      texto.replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(texto.length / 4) * 4, '=')
    );

    return Uint8Array.from(binario, (caractere) => caractere.charCodeAt(0));
  } catch {
    return null;
  }
}

async function assinar(sessao: Sessao, chave: CryptoKey): Promise<string> {
  const conteudo = paraBase64Url(encoder.encode(JSON.stringify(sessao)));
  const assinatura = await crypto.subtle.sign(
    'HMAC',
    chave,
    encoder.encode(conteudo)
  );

  return `${conteudo}.${paraBase64Url(new Uint8Array(assinatura))}`;
}

async function verificar(token: string | null, chave: CryptoKey): Promise<Sessao | null> {
  if (!token || token.length > 2048) return null;

  const partes = token.split('.');
  if (partes.length !== 2) return null;

  const conteudo = deBase64Url(partes[0]);
  const assinatura = deBase64Url(partes[1]);

  if (!conteudo || !assinatura || assinatura.byteLength !== 32) return null;

  const valido = await crypto.subtle.verify(
    'HMAC',
    chave,
    assinatura.slice().buffer as ArrayBuffer,
    encoder.encode(partes[0])
  );

  if (!valido) return null;

  try {
    const dados: unknown = JSON.parse(new TextDecoder().decode(conteudo));
    if (!dados || typeof dados !== 'object') return null;

    const sessao = dados as Sessao;
    const agora = Math.floor(Date.now() / 1000);

    if (
      sessao.v !== 1 ||
      !ehChave(sessao.chave) ||
      !Number.isInteger(sessao.iat) ||
      !Number.isInteger(sessao.exp) ||
      sessao.iat > agora + 60 ||
      sessao.exp <= agora ||
      sessao.exp - sessao.iat > SEGUNDOS_SESSAO
    ) return null;

    return sessao;
  } catch {
    return null;
  }
}

function extrairCookie(request: Request): string | null {
  const cookies = request.headers.get('Cookie') ?? '';

  const item = cookies.split(';')
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${COOKIE}=`));

  return item ? item.slice(COOKIE.length + 1) : null;
}

function cookieDeSessao(request: Request, valor: string, duracao: number): string {
  const hostname = new URL(request.url).hostname;

  // Browsers podem usar localhost HTTP durante os testes com Wrangler.
  const local = hostname === 'localhost' || hostname === '127.0.0.1';

  return `${COOKIE}=${valor}; Path=/login; HttpOnly; SameSite=Lax; Max-Age=${duracao}${local ? '' : '; Secure'}`;
}

function redirecionar(destino: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: destino,
      'Cache-Control': 'no-store',
    },
  });
}

async function autenticar(request: Request, env: Ambiente): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false }, 405, { Allow: 'POST' });
  }

  // Evita requisições enviadas de outras origens; não habilitar CORS nesse endpoint.
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    return json({ ok: false }, 403);
  }

  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
    return json({ ok: false }, 415);
  }

  const tamanho = Number(request.headers.get('Content-Length') ?? 0);
  if (tamanho > 4096) return json({ ok: false }, 413);

  const registros = lerCredenciais(env.H1_LOGIN_CREDENTIALS);
  const chave = await chaveHmac(env.H1_SESSION_KEY);

  if (!registros || !chave) {
    return json({ ok: false, erro: 'indisponivel' }, 503);
  }

  let entrada: unknown;

  try {
    const corpo = await request.text();
    if (corpo.length > 4096) return json({ ok: false }, 413);
    entrada = JSON.parse(corpo);
  } catch {
    return json({ ok: false }, 400);
  }

  if (!entrada || typeof entrada !== 'object') {
    return json({ ok: false }, 400);
  }

  const { usuario, senha } = entrada as Record<string, unknown>;

  if (
    typeof usuario !== 'string' ||
    typeof senha !== 'string' ||
    usuario.length > 100 ||
    senha.length > 128
  ) return json({ ok: false }, 400);

  const usuarioNormalizado = normalizarUsuario(usuario);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';

  const { success } = await env.H1_LOGIN_LIMITER.limit({
    key: `login:${ip}:${usuarioNormalizado}`,
  });

  if (!success) {
    return json(
      { ok: false, erro: 'limite' },
      429,
      { 'Retry-After': '60' }
    );
  }

    const personagem = CHAVES.find((nome) => {

    const registro = registros[nome];

    return normalizarUsuario(registro.usuario) === usuarioNormalizado &&
      registro.senha === senha;
  });

  if (!personagem) return json({ ok: false }, 401);

  const agora = Math.floor(Date.now() / 1000);

  const token = await assinar(
    {
      v: 1,
      chave: personagem,
      iat: agora,
      exp: agora + SEGUNDOS_SESSAO,
    },
    chave
  );

  return json({ ok: true, chave: personagem }, 200, {
    'Set-Cookie': cookieDeSessao(request, token, SEGUNDOS_SESSAO),
  });
}

function destinoDaRota(caminho: string): Chave | null {
  const limpo = caminho
    .replace(/\/+$/, '')
    .replace(/(?:\/index)?\.html$/i, '');

  for (const chave of CHAVES) {
    if (limpo.toLowerCase() === rotas[chave].toLowerCase()) {
      return chave;
    }
  }

  return null;
}

async function servirAreaInterna(
  request: Request,
  env: Ambiente,
  url: URL
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Método não permitido', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  const chave = await chaveHmac(env.H1_SESSION_KEY);

  if (!chave) {
    return new Response('Acesso temporariamente indisponível.', {
      status: 503,
    });
  }

  const sessao = await verificar(extrairCookie(request), chave);
  if (!sessao) return redirecionar('/');

  let caminho: string;

  try {
    caminho = decodeURIComponent(url.pathname).replace(/\/{2,}/g, '/');
  } catch {
    return new Response('URL inválida', { status: 400 });
  }

  const caminhoNormalizado = caminho
    .replace(/\/+$/, '')
    .replace(/(?:\/index)?\.html$/i, '');

  const ehPortal = caminhoNormalizado.toLowerCase() === '/login';

  if (ehPortal) {
    // A query string é controlável pelo usuário, portanto deve coincidir com a sessão.
    if (url.searchParams.get('personagem') !== sessao.chave) {
      return redirecionar(
        `/login?tema=hibrido&personagem=${sessao.chave}`
      );
    }
  } else {
    const personagemDaRota = destinoDaRota(caminho);

    if (!personagemDaRota) {
      return new Response('Não encontrado', { status: 404 });
    }

    if (personagemDaRota !== sessao.chave) {
      return redirecionar(rotas[sessao.chave]);
    }
  }

  const resposta = await env.ASSETS.fetch(request);

  // O HTML protegido não deve ficar disponível em caches intermediários.
  const cabecalhos = new Headers(resposta.headers);
  cabecalhos.set('Cache-Control', 'private, no-store');
  cabecalhos.set('X-Robots-Tag', 'noindex, nofollow');

  return new Response(resposta.body, {
    status: resposta.status,
    statusText: resposta.statusText,
    headers: cabecalhos,
  });
}

export default {
  async fetch(request: Request, env: Ambiente): Promise<Response> {
    const url = new URL(request.url);


    if (url.pathname === '/api/login') {
      return autenticar(request, env);
    }

    if (url.pathname === '/api/logout') {
      if (request.method !== 'POST') {
        return json({ ok: false }, 405, { Allow: 'POST' });
      }

      if (request.headers.get('Origin') !== url.origin) {
        return json({ ok: false }, 403);
      }

      return json({ ok: true }, 200, {
        'Set-Cookie': cookieDeSessao(request, '', 0),
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false }, 404);
    }


    if (/^\/login(?:\/|$|\.html)/i.test(url.pathname)) {
      return servirAreaInterna(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
};
