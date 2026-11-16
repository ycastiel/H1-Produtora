// QUERO VER INSPECIONAR O ELEMENTO AGORA, SAFADO!!!
export const personagens = [
  { chave: 'bene', nome: 'Benê', rota: '/login/Bene' },
  { chave: 'leonardo', nome: 'Leonardo', rota: '/login/Leonardo' },
  { chave: 'jeff', nome: 'Jeff', rota: '/login/Jeff' },
  { chave: 'wolftheus', nome: 'Wolftheus', rota: '/login/Wolftheus' },
] as const;

export type ChavePersonagem = (typeof personagens)[number]['chave'];

export function buscarPersonagem(chave: string | null) {
  return personagens.find((personagem) => personagem.chave === chave) ?? personagens[0];
}
