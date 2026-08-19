/**
 * "Personal note" cold-email style — the default outreach format.
 *
 * Short, plain-looking notes (no logo, no cards, Arial, text/plain part
 * included) written like one owner writing to another: specific observations
 * pulled from the lead's REAL public profile data, loss-aversion framing, a
 * single tiny reply-CTA and a P.S. — persistent-but-warm sales psychology,
 * always honest (public information only, no fabricated claims).
 *
 * Per language: 3 initial variants (angles: findings / lost customer /
 * compliment ladder) + 2 follow-up templates (bump: "it's me again",
 * breakup: "last time, promise"). The initial variant is picked
 * deterministically by Place-ID hash; each follow-up must use a variant
 * different from every previous send (pickNoteVariant).
 *
 * The footer reuses the dashboard locale strings (reasonLine +
 * assessmentNote + unsubscribe), so both styles disclose identically.
 */

import type { EmailLanguage } from '../../shared/types'
import type { PlaceProfileSummary } from '../scoring/types'
import { EMAIL_LOCALES } from './locales'
import { hashString } from './render'

export const NOTE_VARIANT_COUNT = 3
/** Initial send + at most two follow-ups. */
export const MAX_SENDS = 3

/** Everything a template can interpolate. f1 always exists; f2 may not. */
export type NoteCtx = {
  name: string
  city: string
  rating: number | null
  reviews: number | null
  score: number
  /** Top two localized findings (rotated per variant so sends differ). */
  f1: string
  f2: string | null
  sender: string
}

export type Template = {
  subject: (ctx: NoteCtx) => string
  paragraphs: (ctx: NoteCtx) => string[]
  ps?: (ctx: NoteCtx) => string
}

export type NotePack = {
  findings: {
    noPhotos: string
    fewPhotos: (n: number) => string
    noHours: string
    noDescription: string
    noReviews: string
    fewReviews: (n: number) => string
    /** Fallback f1 when the profile has no real gaps. */
    clean: string
  }
  variants: [Template, Template, Template]
  /** [bump (2nd send), breakup (3rd send)] */
  followups: [Template, Template]
  signoff: string
}

const r1 = (n: number): string => n.toFixed(1)

/* ─────────────────────────── PT ─────────────────────────── */
const pt: NotePack = {
  findings: {
    noPhotos: 'o perfil está sem fotos, e quem compara no Google decide pelo olho',
    fewPhotos: (n) => `o perfil tem só ${n} foto${n === 1 ? '' : 's'}, e quem compara no Google decide pelo olho`,
    noHours: 'não tem horário de funcionamento cadastrado, e o Google esconde perfis assim de quem filtra por “aberto agora”',
    noDescription: 'está sem descrição do negócio, então o Google não sabe direito o que vocês vendem, e deixa de mostrar vocês',
    noReviews: 'ainda não tem nenhuma avaliação no Google, e avaliação é a primeira coisa que o cliente novo olha',
    fewReviews: (n) => `tem só ${n} avaliações no Google, pouco perto da confiança que vocês já conquistaram na prática`,
    clean: 'o perfil está bem cuidado. O desafio agora é manter no ritmo, que é onde a maioria escorrega',
  },
  variants: [
    {
      subject: ({ name }) => `sobre o perfil da ${name} no Google`,
      paragraphs: (c) => [
        `Oi! Aqui é ${c.sender}, da Brandstash. Dei uma olhada no perfil da ${c.name} no Google (análise pública, sem acesso a nada de vocês) e ${c.f2 ? 'dois detalhes' : 'um detalhe'} me chamou atenção:`,
        `- ${c.f1};`,
        ...(c.f2 ? [`- ${c.f2}.`] : []),
        `Parece pequeno, mas é exatamente isso que decide quem aparece primeiro quando alguém procura em ${c.city}. E consertar é rápido.`,
        `A Brandstash faz esses ajustes e mantém tudo rodando sozinha (fotos, horários, novidades, avaliações respondidas) enquanto você toca o negócio.`,
        `Quer ver o que a gente arrumaria primeiro na ${c.name}? Me responde um “quero” que eu te mostro, sem compromisso.`,
      ],
      ps: (c) => `P.S.: na nossa análise o perfil está ${r1(c.score)}/10 hoje. Dá para subir bem rápido.`,
    },
    {
      subject: ({ name }) => `o cliente que procurou e não achou a ${name}`,
      paragraphs: (c) => [
        `Oi, tudo bem? ${c.sender}, da Brandstash.`,
        `Agora mesmo tem gente em ${c.city} procurando no Google exatamente o que a ${c.name} oferece. E sabe quem leva esse cliente? O concorrente com o perfil mais completo, mesmo quando o serviço dele é pior que o seu.`,
        `Olhei o perfil de vocês (só informação pública) e achei o motivo: ${c.f1}.${c.f2 ? ` E ainda: ${c.f2}.` : ''}`,
        `Cada dia assim é cliente indo parar no vizinho. A boa notícia: isso se resolve em poucos dias, e a Brandstash mantém resolvido no automático.`,
        `Posso te mostrar em 2 minutos como ficaria? É só responder este email.`,
      ],
      ps: () => `P.S.: não precisamos de senha nem de acesso a nada: trabalhamos só com o que já é público.`,
    },
    {
      subject: (c) =>
        c.rating != null ? `sua nota ${r1(c.rating)}★ merece mais, ${c.name}` : `a ${c.name} merece mais destaque no Google`,
      paragraphs: (c) => [
        c.rating != null
          ? `Vou ser direto: nota ${r1(c.rating)}★${c.reviews ? ` com ${c.reviews} avaliações` : ''} não se constrói por acaso. Parabéns, sério.`
          : `Vou ser direto: dá para ver que a ${c.name} leva o negócio a sério.`,
        `Só que o perfil de vocês no Google não está à altura disso: ${c.f1}. É como ter a melhor loja da rua com a vitrine apagada.`,
        `Quem entrega o serviço é você. Manter a vitrine acesa (fotos novas, horários certos, avaliações respondidas, novidades no ar) é a Brandstash que faz, sozinha, todo dia.`,
        `Topa ver o que mudaria na prática para a ${c.name}? Responde aqui que eu te mostro. Se não fizer sentido, sem problema nenhum.`,
      ],
      ps: () => `P.S.: a análise é gratuita e já é sua. Use como quiser, com ou sem a gente.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `eu de novo, ${name} :)`,
      paragraphs: (c) => [
        `Oi! Sou eu de novo, ${c.sender} da Brandstash.`,
        `Te escrevi há alguns dias sobre o perfil da ${c.name} no Google (resumindo: ${c.f1}). Sei bem como é a correria de quem toca negócio, então vou direto ao ponto:`,
        `a oferta continua de pé: em 2 minutos te mostro o que a gente consertaria primeiro, e você decide se faz sentido. É só responder “mostra”.`,
      ],
      ps: () => `P.S.: se não for prioridade agora, me responde um “depois” que eu volto noutro momento, sem estresse.`,
    },
    {
      subject: ({ name }) => `última vez, prometo: ${name}`,
      paragraphs: (c) => [
        `Prometo que esta é minha última mensagem. Aqui é ${c.sender}, da Brandstash.`,
        `Escrevi duas vezes sobre o perfil da ${c.name} no Google e imagino que o momento não seja esse. Tudo bem, de verdade.`,
        `Antes de sair, um presente. O conserto nº 1 do perfil de vocês é este: ${c.f1}. Mesmo sem a gente, vale fazer ainda esta semana.`,
        `E se um dia quiser o perfil trabalhando por você no automático, é só responder este email (ele não expira). Sucesso com a ${c.name}!`,
      ],
    },
  ],
  signoff: 'Abraço,',
}

/* ─────────────────────────── EN ─────────────────────────── */
const en: NotePack = {
  findings: {
    noPhotos: 'the profile has no photos, and people comparing on Google decide with their eyes',
    fewPhotos: (n) => `the profile only has ${n} photo${n === 1 ? '' : 's'}, and people comparing on Google decide with their eyes`,
    noHours: 'there are no opening hours listed, so Google hides profiles like that from anyone filtering by “open now”',
    noDescription: 'there’s no business description, so Google can’t tell exactly what you sell, so it shows you less',
    noReviews: 'there are no Google reviews yet, and reviews are the first thing a new customer checks',
    fewReviews: (n) => `there are only ${n} Google reviews, far fewer than the trust you’ve clearly earned in person`,
    clean: 'the profile is in good shape. The challenge now is keeping it that way, which is where most businesses slip',
  },
  variants: [
    {
      subject: ({ name }) => `about ${name}'s Google profile`,
      paragraphs: (c) => [
        `Hi! This is ${c.sender} from Brandstash. I took a look at ${c.name}'s Google profile (public check, no access to anything of yours) and ${c.f2 ? 'two things' : 'one thing'} jumped out:`,
        `- ${c.f1};`,
        ...(c.f2 ? [`- ${c.f2}.`] : []),
        `It looks small, but this is exactly what decides who shows up first when someone searches in ${c.city}. And it's a quick fix.`,
        `Brandstash makes those fixes and keeps everything running by itself (photos, hours, updates, reviews answered) while you run the business.`,
        `Want to see what we'd fix first at ${c.name}? Just reply “show me” and I'll send it over, no strings attached.`,
      ],
      ps: (c) => `P.S.: our check scores the profile ${r1(c.score)}/10 today. It can climb fast.`,
    },
    {
      subject: ({ name }) => `the customer who searched and didn't find ${name}`,
      paragraphs: (c) => [
        `Hi there! ${c.sender} from Brandstash.`,
        `Right now, someone in ${c.city} is searching Google for exactly what ${c.name} offers. Guess who gets that customer? The competitor with the more complete profile, even when their work is worse than yours.`,
        `I looked at your profile (public information only) and found why: ${c.f1}.${c.f2 ? ` Also: ${c.f2}.` : ''}`,
        `Every day like this is a customer walking next door. The good news: it's fixable in days, and Brandstash keeps it fixed on autopilot.`,
        `Can I show you in 2 minutes what it would look like? Just reply to this email.`,
      ],
      ps: () => `P.S.: no passwords, no account access: we work with what's already public.`,
    },
    {
      subject: (c) => (c.rating != null ? `your ${r1(c.rating)}★ deserves better, ${c.name}` : `${c.name} deserves more spotlight on Google`),
      paragraphs: (c) => [
        c.rating != null
          ? `I'll be direct: a ${r1(c.rating)}★ rating${c.reviews ? ` across ${c.reviews} reviews` : ''} doesn't happen by accident. Genuinely, congrats.`
          : `I'll be direct: it's obvious ${c.name} takes the work seriously.`,
        `But your Google profile isn't living up to it: ${c.f1}. It's like having the best shop on the street with the lights off in the window.`,
        `You deliver the work. Keeping the window lit (fresh photos, correct hours, reviews answered, updates posted): that's what Brandstash does, by itself, every day.`,
        `Want to see what would actually change for ${c.name}? Reply here and I'll show you. If it's not a fit, no hard feelings.`,
      ],
      ps: () => `P.S.: the analysis is free and it's yours either way. Use it with or without us.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `me again, ${name} :)`,
      paragraphs: (c) => [
        `Hi! It's me again: ${c.sender} from Brandstash.`,
        `I wrote a few days ago about ${c.name}'s Google profile (short version: ${c.f1}). I know how busy running a business gets, so straight to it:`,
        `the offer stands: 2 minutes and I'll show you what we'd fix first, then you decide. Just reply “show me”.`,
      ],
      ps: () => `P.S.: if now's not the time, reply “later” and I'll circle back, no pressure.`,
    },
    {
      subject: ({ name }) => `last one, promise: ${name}`,
      paragraphs: (c) => [
        `I promise this is my last message. ${c.sender} here, from Brandstash.`,
        `I've written twice about ${c.name}'s Google profile, so I'll take the hint that now isn't the moment. Truly fine.`,
        `Before I go, a parting gift. Your profile's #1 fix is this: ${c.f1}. Even without us, it's worth doing this week.`,
        `And if you ever want the profile working for you on autopilot, just reply to this email (it doesn't expire). All the best with ${c.name}!`,
      ],
    },
  ],
  signoff: 'Best,',
}

/* ─────────────────────────── ES ─────────────────────────── */
const es: NotePack = {
  findings: {
    noPhotos: 'el perfil no tiene fotos, y quien compara en Google decide con los ojos',
    fewPhotos: (n) => `el perfil solo tiene ${n} foto${n === 1 ? '' : 's'}, y quien compara en Google decide con los ojos`,
    noHours: 'no hay horario de atención cargado, y Google esconde estos perfiles de quien filtra por “abierto ahora”',
    noDescription: 'falta la descripción del negocio, así que Google no sabe bien qué venden y los muestra menos',
    noReviews: 'todavía no hay reseñas en Google, y las reseñas son lo primero que mira un cliente nuevo',
    fewReviews: (n) => `solo hay ${n} reseñas en Google, muy poco para la confianza que ya se ganaron en persona`,
    clean: 'el perfil está bien cuidado. El desafío ahora es mantenerlo, que es donde la mayoría afloja',
  },
  variants: [
    {
      subject: ({ name }) => `sobre el perfil de ${name} en Google`,
      paragraphs: (c) => [
        `¡Hola! Soy ${c.sender}, de Brandstash. Revisé el perfil de ${c.name} en Google (análisis público, sin acceso a nada suyo) y ${c.f2 ? 'dos detalles' : 'un detalle'} me llamaron la atención:`,
        `- ${c.f1};`,
        ...(c.f2 ? [`- ${c.f2}.`] : []),
        `Parece menor, pero es exactamente lo que decide quién aparece primero cuando alguien busca en ${c.city}. Y arreglarlo es rápido.`,
        `Brandstash hace esos ajustes y mantiene todo funcionando solo (fotos, horarios, novedades, reseñas respondidas) mientras usted atiende el negocio.`,
        `¿Quiere ver qué arreglaríamos primero en ${c.name}? Respóndame “quiero” y se lo muestro, sin compromiso.`,
      ],
      ps: (c) => `P.D.: en nuestro análisis el perfil está hoy en ${r1(c.score)}/10. Puede subir rápido.`,
    },
    {
      subject: ({ name }) => `el cliente que buscó y no encontró a ${name}`,
      paragraphs: (c) => [
        `Hola, ¿qué tal? ${c.sender}, de Brandstash.`,
        `Ahora mismo hay gente en ${c.city} buscando en Google exactamente lo que ofrece ${c.name}. ¿Sabe quién se lleva a ese cliente? El competidor con el perfil más completo, aunque su servicio sea peor que el suyo.`,
        `Miré su perfil (solo información pública) y encontré el porqué: ${c.f1}.${c.f2 ? ` Además: ${c.f2}.` : ''}`,
        `Cada día así es un cliente que termina con el vecino. La buena noticia: se resuelve en días, y Brandstash lo mantiene resuelto en automático.`,
        `¿Le muestro en 2 minutos cómo quedaría? Solo responda este correo.`,
      ],
      ps: () => `P.D.: no necesitamos contraseñas ni acceso a nada: trabajamos solo con lo que ya es público.`,
    },
    {
      subject: (c) => (c.rating != null ? `su ${r1(c.rating)}★ merece más, ${c.name}` : `${c.name} merece más protagonismo en Google`),
      paragraphs: (c) => [
        c.rating != null
          ? `Seré directo: una nota de ${r1(c.rating)}★${c.reviews ? ` con ${c.reviews} reseñas` : ''} no se construye por casualidad. Felicitaciones, en serio.`
          : `Seré directo: se nota que en ${c.name} se toman el trabajo en serio.`,
        `Pero su perfil de Google no está a la altura: ${c.f1}. Es como tener la mejor tienda de la calle con la vitrina apagada.`,
        `El servicio lo pone usted. Mantener la vitrina encendida (fotos nuevas, horarios correctos, reseñas respondidas, novedades publicadas) lo hace Brandstash, solo, todos los días.`,
        `¿Quiere ver qué cambiaría en la práctica para ${c.name}? Responda aquí y se lo muestro. Si no tiene sentido, no pasa nada.`,
      ],
      ps: () => `P.D.: el análisis es gratis y ya es suyo. Úselo con o sin nosotros.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `yo otra vez, ${name} :)`,
      paragraphs: (c) => [
        `¡Hola! Soy yo otra vez, ${c.sender} de Brandstash.`,
        `Le escribí hace unos días sobre el perfil de ${c.name} en Google (en resumen: ${c.f1}). Sé lo ocupado que es llevar un negocio, así que voy al grano:`,
        `la oferta sigue en pie: en 2 minutos le muestro qué arreglaríamos primero, y usted decide. Solo responda “muéstrame”.`,
      ],
      ps: () => `P.D.: si ahora no es prioridad, respóndame “después” y vuelvo en otro momento, sin presión.`,
    },
    {
      subject: ({ name }) => `la última, lo prometo: ${name}`,
      paragraphs: (c) => [
        `Prometo que este es mi último mensaje. Le escribe ${c.sender}, de Brandstash.`,
        `Le escribí dos veces sobre el perfil de ${c.name} en Google, así que entiendo que no es el momento. Está bien, de verdad.`,
        `Antes de irme, un regalo. El arreglo nº 1 de su perfil es este: ${c.f1}. Incluso sin nosotros, vale la pena hacerlo esta semana.`,
        `Y si algún día quiere el perfil trabajando en automático, solo responda este correo (no caduca). ¡Éxitos con ${c.name}!`,
      ],
    },
  ],
  signoff: 'Un saludo,',
}

/* ─────────────────────────── FR ─────────────────────────── */
const fr: NotePack = {
  findings: {
    noPhotos: 'la fiche n’a aucune photo, or, sur Google, on compare d’abord avec les yeux',
    fewPhotos: (n) => `la fiche n’a que ${n} photo${n === 1 ? '' : 's'}, or, sur Google, on compare d’abord avec les yeux`,
    noHours: 'aucun horaire n’est renseigné, et Google masque ces fiches à ceux qui filtrent par « ouvert maintenant »',
    noDescription: 'la description de l’établissement manque, donc Google ne sait pas précisément ce que vous proposez, et vous montre moins',
    noReviews: 'il n’y a pas encore d’avis Google, et les avis sont la première chose qu’un nouveau client regarde',
    fewReviews: (n) => `il n’y a que ${n} avis Google, bien peu au regard de la confiance déjà gagnée sur place`,
    clean: 'la fiche est bien tenue. Le défi est désormais de garder le rythme, là où la plupart décrochent',
  },
  variants: [
    {
      subject: ({ name }) => `au sujet de la fiche Google de ${name}`,
      paragraphs: (c) => [
        `Bonjour ! ${c.sender}, de Brandstash. J’ai examiné la fiche Google de ${c.name} (analyse publique, aucun accès à vos comptes) et ${c.f2 ? 'deux détails' : 'un détail'} m’ont interpellé :`,
        `- ${c.f1} ;`,
        ...(c.f2 ? [`- ${c.f2}.`] : []),
        `Cela paraît mineur, mais c’est exactement ce qui décide qui apparaît en premier quand on cherche à ${c.city}. Et c’est rapide à corriger.`,
        `Brandstash effectue ces réglages et fait tourner l’ensemble tout seul (photos, horaires, actualités, avis traités) pendant que vous faites tourner l’établissement.`,
        `Voulez-vous voir ce que nous corrigerions en premier pour ${c.name} ? Répondez simplement « je veux voir », sans engagement.`,
      ],
      ps: (c) => `P.S. : notre analyse note la fiche ${r1(c.score)}/10 aujourd’hui. Elle peut grimper vite.`,
    },
    {
      subject: ({ name }) => `le client qui a cherché sans trouver ${name}`,
      paragraphs: (c) => [
        `Bonjour ! ${c.sender}, de Brandstash.`,
        `En ce moment même, quelqu’un à ${c.city} cherche sur Google exactement ce que propose ${c.name}. Devinez qui gagne ce client ? Le concurrent à la fiche la plus complète, même quand son travail vaut moins que le vôtre.`,
        `J’ai regardé votre fiche (informations publiques uniquement) et trouvé pourquoi : ${c.f1}.${c.f2 ? ` Et aussi : ${c.f2}.` : ''}`,
        `Chaque jour ainsi, c’est un client qui va chez le voisin. La bonne nouvelle : cela se règle en quelques jours, et Brandstash maintient le tout en pilote automatique.`,
        `Puis-je vous montrer en 2 minutes ce que cela donnerait ? Répondez simplement à cet e-mail.`,
      ],
      ps: () => `P.S. : ni mot de passe, ni accès à quoi que ce soit : nous travaillons uniquement avec ce qui est déjà public.`,
    },
    {
      subject: (c) => (c.rating != null ? `vos ${r1(c.rating)}★ méritent mieux, ${c.name}` : `${c.name} mérite plus de visibilité sur Google`),
      paragraphs: (c) => [
        c.rating != null
          ? `Je serai direct : une note de ${r1(c.rating)}★${c.reviews ? ` sur ${c.reviews} avis` : ''} ne doit rien au hasard. Sincèrement, bravo.`
          : `Je serai direct : on voit que ${c.name} prend son métier au sérieux.`,
        `Mais votre fiche Google n’est pas à la hauteur : ${c.f1}. C’est la meilleure boutique de la rue… vitrine éteinte.`,
        `Le savoir-faire, c’est vous. Garder la vitrine allumée (photos récentes, horaires exacts, avis traités, actualités publiées), c’est Brandstash qui s’en charge, tout seul, chaque jour.`,
        `Voulez-vous voir ce que cela changerait concrètement pour ${c.name} ? Répondez ici, je vous montre. Si cela ne convient pas, aucun souci.`,
      ],
      ps: () => `P.S. : l’analyse est gratuite et vous appartient, avec ou sans nous.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `c’est encore moi, ${name}`,
      paragraphs: (c) => [
        `Bonjour ! C’est encore moi, ${c.sender} de Brandstash.`,
        `Je vous ai écrit il y a quelques jours au sujet de la fiche Google de ${c.name} (en bref : ${c.f1}). Je sais combien vos journées sont pleines, alors j’irai droit au but :`,
        `ma proposition tient toujours : en 2 minutes, je vous montre ce que nous corrigerions en premier, et vous décidez. Répondez simplement « montrez-moi ».`,
      ],
      ps: () => `P.S. : si ce n’est pas le moment, répondez « plus tard » et je reviendrai vers vous, sans insister.`,
    },
    {
      subject: ({ name }) => `dernier message, promis : ${name}`,
      paragraphs: (c) => [
        `Promis, c’est mon dernier message. ${c.sender}, de Brandstash.`,
        `Je vous ai écrit deux fois au sujet de la fiche Google de ${c.name} ; j’en déduis que le moment est mal choisi. Aucun problème, sincèrement.`,
        `Avant de partir, un cadeau. La correction n° 1 de votre fiche, c’est celle-ci : ${c.f1}. Même sans nous, elle vaut la peine d’être faite cette semaine.`,
        `Et si un jour vous voulez une fiche qui travaille pour vous en automatique, répondez simplement à cet e-mail (il n’expire pas). Belle continuation avec ${c.name} !`,
      ],
    },
  ],
  signoff: 'Bien à vous,',
}

/* ─────────────────────────── DE ─────────────────────────── */
const de: NotePack = {
  findings: {
    noPhotos: 'das Profil hat keine Fotos, und wer auf Google vergleicht, entscheidet mit den Augen',
    fewPhotos: (n) => `das Profil hat nur ${n} Foto${n === 1 ? '' : 's'}, und wer auf Google vergleicht, entscheidet mit den Augen`,
    noHours: 'es sind keine Öffnungszeiten hinterlegt, und Google blendet solche Profile bei „jetzt geöffnet“ aus',
    noDescription: 'die Unternehmensbeschreibung fehlt, also weiß Google nicht genau, was Sie anbieten, und zeigt Sie seltener',
    noReviews: 'es gibt noch keine Google-Bewertungen, dabei sind Bewertungen das Erste, was Neukunden prüfen',
    fewReviews: (n) => `es gibt nur ${n} Google-Bewertungen, deutlich weniger, als das Vertrauen vermuten lässt, das Sie sich vor Ort erarbeitet haben`,
    clean: 'das Profil ist gepflegt. Die Herausforderung ist jetzt, dranzubleiben; genau da lassen die meisten nach',
  },
  variants: [
    {
      subject: ({ name }) => `zum Google-Profil von ${name}`,
      paragraphs: (c) => [
        `Guten Tag! Hier ist ${c.sender} von Brandstash. Ich habe mir das Google-Profil von ${c.name} angesehen (öffentliche Analyse, kein Zugriff auf Ihre Konten), und ${c.f2 ? 'zwei Punkte' : 'ein Punkt'} sind mir aufgefallen:`,
        `- ${c.f1};`,
        ...(c.f2 ? [`- ${c.f2}.`] : []),
        `Klingt nach Kleinigkeiten, aber genau das entscheidet, wer zuerst erscheint, wenn jemand in ${c.city} sucht. Und es ist schnell behoben.`,
        `Brandstash übernimmt diese Korrekturen und hält alles von selbst am Laufen (Fotos, Öffnungszeiten, Neuigkeiten, beantwortete Bewertungen), während Sie Ihr Geschäft führen.`,
        `Möchten Sie sehen, was wir bei ${c.name} zuerst beheben würden? Antworten Sie einfach mit „zeigen“, unverbindlich.`,
      ],
      ps: (c) => `P.S.: Unsere Analyse bewertet das Profil aktuell mit ${r1(c.score)}/10. Da geht schnell mehr.`,
    },
    {
      subject: ({ name }) => `der Kunde, der ${name} gesucht und nicht gefunden hat`,
      paragraphs: (c) => [
        `Guten Tag! ${c.sender} von Brandstash.`,
        `Genau jetzt sucht jemand in ${c.city} auf Google nach dem, was ${c.name} anbietet. Wissen Sie, wer diesen Kunden bekommt? Der Wettbewerber mit dem vollständigeren Profil, selbst wenn seine Arbeit schlechter ist als Ihre.`,
        `Ich habe Ihr Profil geprüft (nur öffentliche Informationen) und den Grund gefunden: ${c.f1}.${c.f2 ? ` Außerdem: ${c.f2}.` : ''}`,
        `Jeder Tag so ist ein Kunde, der nebenan landet. Die gute Nachricht: Das ist in wenigen Tagen behoben, und Brandstash hält es automatisch in Ordnung.`,
        `Darf ich Ihnen in 2 Minuten zeigen, wie das aussähe? Antworten Sie einfach auf diese E-Mail.`,
      ],
      ps: () => `P.S.: Keine Passwörter, kein Kontozugriff: Wir arbeiten ausschließlich mit dem, was bereits öffentlich ist.`,
    },
    {
      subject: (c) => (c.rating != null ? `Ihre ${r1(c.rating)}★ verdienen mehr, ${c.name}` : `${c.name} verdient mehr Sichtbarkeit auf Google`),
      paragraphs: (c) => [
        c.rating != null
          ? `Ich bin direkt: ${r1(c.rating)}★${c.reviews ? ` bei ${c.reviews} Bewertungen` : ''} entstehen nicht zufällig. Ehrlich: Respekt.`
          : `Ich bin direkt: Man sieht, dass ${c.name} seine Arbeit ernst nimmt.`,
        `Nur: Ihr Google-Profil wird dem nicht gerecht: ${c.f1}. Das beste Geschäft der Straße, aber das Schaufenster ist dunkel.`,
        `Die Leistung erbringen Sie. Das Schaufenster hell zu halten (frische Fotos, korrekte Zeiten, beantwortete Bewertungen, aktuelle Beiträge) erledigt Brandstash, von selbst, jeden Tag.`,
        `Möchten Sie sehen, was sich für ${c.name} konkret ändern würde? Antworten Sie hier, ich zeige es Ihnen. Wenn es nicht passt: völlig in Ordnung.`,
      ],
      ps: () => `P.S.: Die Analyse ist kostenlos und gehört Ihnen, mit oder ohne uns.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `ich bin’s nochmal, ${name}`,
      paragraphs: (c) => [
        `Guten Tag! Ich bin’s nochmal: ${c.sender} von Brandstash.`,
        `Vor einigen Tagen habe ich Ihnen zum Google-Profil von ${c.name} geschrieben (kurz: ${c.f1}). Ich weiß, wie voll Ihre Tage sind, deshalb direkt:`,
        `Das Angebot steht: In 2 Minuten zeige ich Ihnen, was wir zuerst beheben würden, und Sie entscheiden. Antworten Sie einfach mit „zeigen“.`,
      ],
      ps: () => `P.S.: Wenn es gerade nicht passt, antworten Sie „später“. Ich melde mich dann zu einem besseren Zeitpunkt.`,
    },
    {
      subject: ({ name }) => `letzte Nachricht, versprochen: ${name}`,
      paragraphs: (c) => [
        `Versprochen: Das ist meine letzte Nachricht. ${c.sender}, von Brandstash.`,
        `Ich habe zweimal zum Google-Profil von ${c.name} geschrieben; vermutlich ist gerade nicht der richtige Zeitpunkt. Vollkommen in Ordnung.`,
        `Zum Abschied ein Geschenk. Korrektur Nr. 1 für Ihr Profil ist diese: ${c.f1}. Auch ohne uns lohnt sie sich noch diese Woche.`,
        `Und falls Sie irgendwann ein Profil möchten, das automatisch für Sie arbeitet: Antworten Sie einfach auf diese E-Mail (sie verfällt nicht). Weiterhin viel Erfolg mit ${c.name}!`,
      ],
    },
  ],
  signoff: 'Freundliche Grüße,',
}

/* ─────────────────────────── IT ─────────────────────────── */
const it: NotePack = {
  findings: {
    noPhotos: 'il profilo non ha foto, e chi confronta su Google decide con gli occhi',
    fewPhotos: (n) => `il profilo ha solo ${n} foto, e chi confronta su Google decide con gli occhi`,
    noHours: 'non ci sono orari di apertura, e Google nasconde questi profili a chi filtra per “aperto ora”',
    noDescription: 'manca la descrizione dell’attività, quindi Google non sa bene cosa offrite e vi mostra meno',
    noReviews: 'non ci sono ancora recensioni su Google, e le recensioni sono la prima cosa che guarda un nuovo cliente',
    fewReviews: (n) => `ci sono solo ${n} recensioni su Google, poche rispetto alla fiducia che vi siete già guadagnati di persona`,
    clean: 'il profilo è curato. La sfida ora è mantenerlo, ed è lì che la maggior parte molla',
  },
  variants: [
    {
      subject: ({ name }) => `sul profilo Google di ${name}`,
      paragraphs: (c) => [
        `Ciao! Sono ${c.sender}, di Brandstash. Ho dato un’occhiata al profilo Google di ${c.name} (analisi pubblica, nessun accesso ai vostri account) e ${c.f2 ? 'due dettagli' : 'un dettaglio'} mi hanno colpito:`,
        `- ${c.f1};`,
        ...(c.f2 ? [`- ${c.f2}.`] : []),
        `Sembra poco, ma è esattamente ciò che decide chi compare per primo quando qualcuno cerca a ${c.city}. E sistemarlo è rapido.`,
        `Brandstash fa queste correzioni e tiene tutto in moto da sola (foto, orari, novità, recensioni con risposta) mentre voi mandate avanti l’attività.`,
        `Vuole vedere cosa sistemeremmo per primo da ${c.name}? Risponda “voglio vedere” e glielo mostro, senza impegno.`,
      ],
      ps: (c) => `P.S.: nella nostra analisi il profilo oggi vale ${r1(c.score)}/10. Può salire in fretta.`,
    },
    {
      subject: ({ name }) => `il cliente che ha cercato e non ha trovato ${name}`,
      paragraphs: (c) => [
        `Buongiorno! ${c.sender}, di Brandstash.`,
        `In questo momento c’è qualcuno a ${c.city} che cerca su Google esattamente quello che offre ${c.name}. Sa chi si prende quel cliente? Il concorrente con il profilo più completo, anche quando lavora peggio di voi.`,
        `Ho guardato il vostro profilo (solo informazioni pubbliche) e ho trovato il perché: ${c.f1}.${c.f2 ? ` E inoltre: ${c.f2}.` : ''}`,
        `Ogni giorno così è un cliente che finisce dal vicino. La buona notizia: si risolve in pochi giorni, e Brandstash lo tiene risolto in automatico.`,
        `Le faccio vedere in 2 minuti come verrebbe? Basta rispondere a questa email.`,
      ],
      ps: () => `P.S.: niente password, niente accessi: lavoriamo solo con ciò che è già pubblico.`,
    },
    {
      subject: (c) => (c.rating != null ? `le sue ${r1(c.rating)}★ meritano di più, ${c.name}` : `${c.name} merita più visibilità su Google`),
      paragraphs: (c) => [
        c.rating != null
          ? `Sarò diretto: una media di ${r1(c.rating)}★${c.reviews ? ` su ${c.reviews} recensioni` : ''} non nasce per caso. Complimenti, davvero.`
          : `Sarò diretto: si vede che ${c.name} fa le cose sul serio.`,
        `Però il vostro profilo Google non è all’altezza: ${c.f1}. È come avere il negozio migliore della via con la vetrina spenta.`,
        `Il mestiere lo mettete voi. Tenere la vetrina accesa (foto fresche, orari giusti, recensioni con risposta, novità pubblicate) lo fa Brandstash, da sola, ogni giorno.`,
        `Vuole vedere cosa cambierebbe in concreto per ${c.name}? Risponda qui e glielo mostro. Se non fa al caso vostro, nessun problema.`,
      ],
      ps: () => `P.S.: l’analisi è gratuita ed è già vostra, con o senza di noi.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `sono di nuovo io, ${name} :)`,
      paragraphs: (c) => [
        `Ciao! Sono di nuovo io, ${c.sender} di Brandstash.`,
        `Le ho scritto qualche giorno fa sul profilo Google di ${c.name} (in breve: ${c.f1}). So bene quanto corre chi manda avanti un’attività, quindi vado dritto al punto:`,
        `l’offerta è ancora valida: in 2 minuti le mostro cosa sistemeremmo per primo, e decide lei. Basta rispondere “mostrami”.`,
      ],
      ps: () => `P.S.: se ora non è una priorità, risponda “più avanti” e mi rifaccio vivo io, senza pressioni.`,
    },
    {
      subject: ({ name }) => `l’ultima, promesso: ${name}`,
      paragraphs: (c) => [
        `Prometto: questo è il mio ultimo messaggio. ${c.sender}, di Brandstash.`,
        `Le ho scritto due volte sul profilo Google di ${c.name}; capisco che non sia il momento. Va benissimo, davvero.`,
        `Prima di salutare, un regalo. La correzione n° 1 del vostro profilo è questa: ${c.f1}. Anche senza di noi, vale la pena farla questa settimana.`,
        `E se un giorno vorrà il profilo che lavora per voi in automatico, basta rispondere a questa email (non scade). In bocca al lupo con ${c.name}!`,
      ],
    },
  ],
  signoff: 'Un saluto,',
}

/* ─────────────────────────── zh-TW ─────────────────────────── */
const zhTW: NotePack = {
  findings: {
    noPhotos: '商家檔案沒有任何相片，而在 Google 上比較的客人，是用眼睛做決定的',
    fewPhotos: (n) => `商家檔案只有 ${n} 張相片，而在 Google 上比較的客人，是用眼睛做決定的`,
    noHours: '沒有填寫營業時間，篩選「營業中」的客人根本看不到這樣的檔案',
    noDescription: '缺少商家介紹，Google 不清楚您賣什麼，曝光自然變少',
    noReviews: '目前還沒有任何 Google 評論，而評論是新客人最先看的東西',
    fewReviews: (n) => `Google 評論只有 ${n} 則，和您實際累積的口碑相比實在太少`,
    clean: '檔案維護得不錯。接下來的挑戰是持續經營，多數店家正是在這裡鬆懈',
  },
  variants: [
    {
      subject: ({ name }) => `關於 ${name} 的 Google 商家檔案`,
      paragraphs: (c) => [
        `您好！我是 Brandstash 的 ${c.sender}。我查看了 ${c.name} 的 Google 商家檔案（純公開資訊分析，未存取您的任何帳號），有${c.f2 ? '兩點' : '一點'}特別想提醒您：`,
        `- ${c.f1}；`,
        ...(c.f2 ? [`- ${c.f2}。`] : []),
        `看似小事，但當有人在${c.city}搜尋時，決定誰排在前面的正是這些細節。而且修正起來很快。`,
        `Brandstash 會自動完成這些調整並持續維護（相片、營業時間、最新動態、評論回覆），您只需專心經營生意。`,
        `想看看我們會先為 ${c.name} 修正什麼嗎？回覆「想看」即可，完全不需承諾。`,
      ],
      ps: (c) => `P.S.：目前檔案在我們的分析中是 ${r1(c.score)}/10 分，提升空間很大也很快。`,
    },
    {
      subject: ({ name }) => `那位搜尋了卻沒找到 ${name} 的客人`,
      paragraphs: (c) => [
        `您好，我是 Brandstash 的 ${c.sender}。`,
        `此刻就有人在${c.city}的 Google 上搜尋 ${c.name} 提供的服務。您猜這位客人去了哪裡？檔案更完整的那家競爭對手，即使對方做得比您差。`,
        `我查了您的檔案（僅公開資訊），找到了原因：${c.f1}。${c.f2 ? `另外：${c.f2}。` : ''}`,
        `每多一天，就多一位客人流向隔壁。好消息是：幾天內就能解決，而且 Brandstash 會自動持續維持。`,
        `可以給我 2 分鐘，讓您看看改善後的樣子嗎？直接回覆這封信即可。`,
      ],
      ps: () => `P.S.：不需要密碼、不需要任何帳號權限，我們只使用已公開的資訊。`,
    },
    {
      subject: (c) => (c.rating != null ? `${c.name}：您的 ${r1(c.rating)}★ 值得更多客人看見` : `${c.name} 值得在 Google 上被更多人看見`),
      paragraphs: (c) => [
        c.rating != null
          ? `直說了：${r1(c.rating)}★${c.reviews ? `（${c.reviews} 則評論）` : ''}的口碑不是偶然。真心佩服。`
          : `直說了：看得出 ${c.name} 是認真在做生意的。`,
        `可惜您的 Google 檔案配不上這份實力：${c.f1}。就像整條街最好的店，卻沒開櫥窗的燈。`,
        `手藝由您負責；讓櫥窗持續亮著（新相片、正確時間、評論回覆、動態更新），由 Brandstash 每天自動完成。`,
        `想看看 ${c.name} 實際會有什麼改變嗎？回覆這封信我就示範給您看。不合適也完全沒關係。`,
      ],
      ps: () => `P.S.：這份分析免費，而且已經是您的了，無論是否與我們合作都能使用。`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `又是我，${name} :)`,
      paragraphs: (c) => [
        `您好！又是我，Brandstash 的 ${c.sender}。`,
        `幾天前我寫信提過 ${c.name} 的 Google 檔案（重點：${c.f1}）。我知道經營生意有多忙，所以直接說：`,
        `提議仍然有效：給我 2 分鐘，讓您看看我們會先修正什麼，再由您決定。回覆「看看」即可。`,
      ],
      ps: () => `P.S.：如果現在不是時候，回覆「之後再說」，我改天再來，不打擾。`,
    },
    {
      subject: ({ name }) => `最後一封，我保證：${name}`,
      paragraphs: (c) => [
        `我保證這是最後一封信，我是 Brandstash 的 ${c.sender}。`,
        `關於 ${c.name} 的 Google 檔案我已寫過兩次，想必現在不是好時機。真的沒關係。`,
        `離開前送您一份小禮物：您檔案的第一優先修正是：${c.f1}。就算不與我們合作，也值得這週就處理。`,
        `哪天想讓檔案自動為您工作了，回覆這封信即可（它不會過期）。祝 ${c.name} 生意興隆！`,
      ],
    },
  ],
  signoff: '祝 順心',
}

/* ─────────────────────────── zh-HK ─────────────────────────── */
const zhHK: NotePack = {
  findings: {
    noPhotos: '商家檔案一張相都冇，而喺 Google 比較嘅客人，係用眼決定嘅',
    fewPhotos: (n) => `商家檔案得 ${n} 張相，而喺 Google 比較嘅客人，係用眼決定嘅`,
    noHours: '未填營業時間，篩選「營業中」嘅客人根本見唔到呢啲檔案',
    noDescription: '未有商家簡介，Google 唔清楚您賣乜嘢，自然少啲展示您',
    noReviews: '暫時一個 Google 評論都未有，而評論係新客最先睇嘅嘢',
    fewReviews: (n) => `Google 評論得 ${n} 個，同您實際儲落嚟嘅口碑完全唔成正比`,
    clean: '檔案打理得唔錯。之後嘅挑戰係keep住，大部分舖頭就係喺呢度鬆懈',
  },
  variants: [
    {
      subject: ({ name }) => `關於 ${name} 嘅 Google 商家檔案`,
      paragraphs: (c) => [
        `您好！我係 Brandstash 嘅 ${c.sender}。我睇咗 ${c.name} 嘅 Google 商家檔案（純公開資料分析，冇掂過您任何帳戶），有${c.f2 ? '兩樣嘢' : '一樣嘢'}想提您：`,
        `- ${c.f1}；`,
        ...(c.f2 ? [`- ${c.f2}。`] : []),
        `睇落係小事，但有人喺${c.city}搜尋嗰陣，邊個排先就係靠呢啲細節。而且好快搞得掂。`,
        `Brandstash 會自動做晒呢啲調整並且持續維護（相片、營業時間、動態、回覆評論），您專心做生意就得。`,
        `想睇吓我哋會幫 ${c.name} 先執邊樣？覆一句「想睇」就得，冇任何承諾。`,
      ],
      ps: (c) => `P.S.：而家個檔案喺我哋分析入面係 ${r1(c.score)}/10 分，升得好快㗎。`,
    },
    {
      subject: ({ name }) => `嗰位搵過但搵唔到 ${name} 嘅客人`,
      paragraphs: (c) => [
        `您好，我係 Brandstash 嘅 ${c.sender}。`,
        `而家就有人喺${c.city}上 Google 搵緊 ${c.name} 提供嘅嘢。估吓位客去咗邊？檔案齊全啲嗰間對手度，就算對方做得冇您咁好。`,
        `我睇咗您個檔案（只用公開資料），搵到原因：${c.f1}。${c.f2 ? `仲有：${c.f2}。` : ''}`,
        `每過一日，就係多一個客去咗隔籬。好消息係：幾日就搞掂，而且 Brandstash 會自動幫您keep住。`,
        `俾 2 分鐘我，show 您改完會係點好唔好？直接覆呢封email就得。`,
      ],
      ps: () => `P.S.：唔使密碼、唔使任何帳戶權限，我哋只用已經公開嘅資料。`,
    },
    {
      subject: (c) => (c.rating != null ? `${c.name}：您嘅 ${r1(c.rating)}★ 值得俾更多人見到` : `${c.name} 值得喺 Google 有更多曝光`),
      paragraphs: (c) => [
        c.rating != null
          ? `直接講：${r1(c.rating)}★${c.reviews ? `（${c.reviews} 個評論）` : ''}嘅口碑唔係彩數。真心佩服。`
          : `直接講：睇得出 ${c.name} 係認真做生意嘅。`,
        `可惜您個 Google 檔案配唔起呢份實力：${c.f1}。好似成條街最好嗰間舖，但櫥窗冇開燈。`,
        `手藝您負責；等個櫥窗長開長亮（新相、啱嘅時間、回覆評論、出動態），就交俾 Brandstash 日日自動做。`,
        `想睇吓 ${c.name} 實際會變成點？覆呢封email我show您。唔啱都完全冇問題。`,
      ],
      ps: () => `P.S.：呢份分析免費，而且已經係您嘅，合唔合作都用得。`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `又係我，${name} :)`,
      paragraphs: (c) => [
        `您好！又係我，Brandstash 嘅 ${c.sender}。`,
        `幾日前我提過 ${c.name} 嘅 Google 檔案（重點：${c.f1}）。我知做生意有幾忙，所以直接講：`,
        `個提議仲有效：俾 2 分鐘我show您我哋會先執乜嘢，然後您話事。覆一句「睇吓」就得。`,
      ],
      ps: () => `P.S.：如果而家唔啱時機，覆句「遲啲先」，我第日再嚟，唔煩您。`,
    },
    {
      subject: ({ name }) => `最後一封，我保證：${name}`,
      paragraphs: (c) => [
        `我保證呢封係最後一封，我係 Brandstash 嘅 ${c.sender}。`,
        `關於 ${c.name} 嘅 Google 檔案我寫過兩次，諗住而家未係時候。真係冇所謂。`,
        `走之前送您份小禮物：您個檔案第一樣要執嘅係：${c.f1}。就算唔搵我哋，都值得今個星期做咗佢。`,
        `第日想個檔案自動幫您做嘢，覆呢封email就得（佢唔會過期）。祝 ${c.name} 生意興隆！`,
      ],
    },
  ],
  signoff: '祝 生意興隆',
}

/* ─────────────────────────── JA ─────────────────────────── */
const ja: NotePack = {
  findings: {
    noPhotos: 'プロフィールに写真が1枚もありません。Googleで比較するお客様は、まず目で選びます',
    fewPhotos: (n) => `プロフィールの写真が${n}枚しかありません。Googleで比較するお客様は、まず目で選びます`,
    noHours: '営業時間が未登録です。「営業中」で絞り込むお客様には表示すらされません',
    noDescription: 'ビジネスの説明文がありません。Googleが何のお店か判断できず、表示機会を失っています',
    noReviews: 'Googleのクチコミがまだありません。新規のお客様が最初に見るのはクチコミです',
    fewReviews: (n) => `Googleのクチコミが${n}件のみです。実際に積み上げてこられた信頼に比べて少なすぎます`,
    clean: 'プロフィールはよく手入れされています。課題はこの状態を「維持」すること。多くの店舗がここで途切れます',
  },
  variants: [
    {
      subject: ({ name }) => `${name}様のGoogleプロフィールについて`,
      paragraphs: (c) => [
        `はじめまして。Brandstashの${c.sender}と申します。${c.name}様のGoogleビジネスプロフィールを拝見し（公開情報のみの分析で、アカウントへのアクセスは一切ありません）、${c.f2 ? '2点' : '1点'}気になったことがありご連絡しました。`,
        `・${c.f1}`,
        ...(c.f2 ? [`・${c.f2}`] : []),
        `些細に見えますが、${c.city}で検索された際にどのお店が上に出るかを決めるのは、まさにこうした点です。しかも修正は短期間で済みます。`,
        `Brandstashは、写真・営業時間・最新情報・クチコミ返信までを自動で整え、維持し続けます。${c.name}様は本業に集中していただくだけです。`,
        `まず何から改善すべきか、ご覧になりますか？「見たい」とご返信いただければ、お送りします。もちろん無料・無条件です。`,
      ],
      ps: (c) => `追伸：当社の分析では、現在のプロフィールは${r1(c.score)}/10点です。短期間で大きく伸ばせます。`,
    },
    {
      subject: ({ name }) => `${name}様を検索したのに見つけられなかったお客様の話`,
      paragraphs: (c) => [
        `Brandstashの${c.sender}と申します。`,
        `今この瞬間も、${c.city}で${c.name}様のようなお店をGoogleで探している方がいます。そのお客様はどこへ行くか。プロフィールがより充実した競合店です。たとえ腕が${c.name}様に及ばなくても、です。`,
        `プロフィールを拝見し（公開情報のみ）、理由が分かりました：${c.f1}。${c.f2 ? `さらに：${c.f2}。` : ''}`,
        `この状態が続く1日1日が、お客様を隣へ送っています。幸い、数日で解決できます。そしてBrandstashが自動で維持し続けます。`,
        `2分だけ、改善後の姿をお見せできますか？このメールにご返信いただくだけで結構です。`,
      ],
      ps: () => `追伸：パスワードもアカウント権限も不要です。すでに公開されている情報のみを使用します。`,
    },
    {
      subject: (c) => (c.rating != null ? `${c.name}様の${r1(c.rating)}★は、もっと知られるべきです` : `${c.name}様はGoogleでもっと見つけられるべきです`),
      paragraphs: (c) => [
        c.rating != null
          ? `率直に申し上げます。${r1(c.rating)}★${c.reviews ? `（クチコミ${c.reviews}件）` : ''}という評価は偶然では生まれません。本当に素晴らしいと思います。`
          : `率直に申し上げます。${c.name}様が真剣に仕事をされていることは、拝見してすぐ分かりました。`,
        `ただ、Googleプロフィールがその実力に追いついていません：${c.f1}。通りで一番のお店なのに、ショーウィンドウの灯りが消えているような状態です。`,
        `本業は${c.name}様の領分。ウィンドウを灯し続けること（新しい写真、正確な営業時間、クチコミ返信、最新情報の投稿）はBrandstashが毎日自動で行います。`,
        `具体的に何が変わるか、ご覧になりませんか？このメールにご返信ください。合わなければ、それで構いません。`,
      ],
      ps: () => `追伸：この分析は無料で、既に貴店のものです。当社をご利用にならなくてもお役立てください。`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `${name}様、再びのご連絡です`,
      paragraphs: (c) => [
        `再びのご連絡失礼します。Brandstashの${c.sender}です。`,
        `先日、${c.name}様のGoogleプロフィールについてお送りしました（要点：${c.f1}）。お忙しい毎日と存じますので、単刀直入に。`,
        `ご提案は引き続き有効です。2分で「まず何を直すか」をお見せしますので、その上でご判断ください。「見たい」とご返信いただくだけです。`,
      ],
      ps: () => `追伸：今は優先でなければ「また今度」とご返信ください。改めてご連絡します。しつこくはいたしません。`,
    },
    {
      subject: ({ name }) => `${name}様、最後のご連絡です`,
      paragraphs: (c) => [
        `お約束します。これが最後のメールです。Brandstashの${c.sender}です。`,
        `${c.name}様のGoogleプロフィールについて二度お送りしましたが、今はタイミングではないのだと思います。まったく問題ございません。`,
        `最後に一つ、贈り物を。プロフィール改善の最優先事項は、${c.f1}。当社を使わずとも、今週中の対応をお勧めします。`,
        `いつかプロフィールを自動で任せたくなったら、このメールにご返信ください（期限はありません）。${c.name}様のご繁盛をお祈りしています。`,
      ],
    },
  ],
  signoff: '何卒よろしくお願いいたします。',
}

/* ─────────────────────────── KO ─────────────────────────── */
const ko: NotePack = {
  findings: {
    noPhotos: '프로필에 사진이 한 장도 없습니다. Google에서 비교하는 손님은 눈으로 결정합니다',
    fewPhotos: (n) => `프로필에 사진이 ${n}장뿐입니다. Google에서 비교하는 손님은 눈으로 결정합니다`,
    noHours: '영업시간이 등록되어 있지 않습니다. “영업 중”으로 검색하는 손님에게는 아예 보이지 않습니다',
    noDescription: '업체 설명이 없습니다. Google이 무엇을 파는 곳인지 몰라 노출을 줄입니다',
    noReviews: '아직 Google 리뷰가 없습니다. 새 손님이 가장 먼저 보는 것이 리뷰입니다',
    fewReviews: (n) => `Google 리뷰가 ${n}개뿐입니다. 실제로 쌓아 오신 신뢰에 비해 너무 적습니다`,
    clean: '프로필 관리가 잘 되어 있습니다. 이제 관건은 꾸준함인데, 대부분 여기서 무너집니다',
  },
  variants: [
    {
      subject: ({ name }) => `${name}의 Google 프로필에 관해`,
      paragraphs: (c) => [
        `안녕하세요, Brandstash의 ${c.sender}입니다. ${c.name}의 Google 비즈니스 프로필을 살펴봤는데요(공개 정보만 분석했고 계정 접근은 전혀 없습니다), ${c.f2 ? '두 가지' : '한 가지'}가 눈에 띄어 연락드립니다.`,
        `- ${c.f1}`,
        ...(c.f2 ? [`- ${c.f2}`] : []),
        `사소해 보여도, ${c.city}에서 누군가 검색할 때 누가 먼저 보이는지는 바로 이런 것들이 결정합니다. 고치는 건 금방입니다.`,
        `Brandstash가 이 수정을 하고 사진·영업시간·소식·리뷰 답변까지 전부 자동으로 유지합니다. 사장님은 본업에만 집중하시면 됩니다.`,
        `${c.name}에서 무엇부터 고칠지 보여드릴까요? “보고 싶다”라고 답장만 주세요. 아무 조건 없습니다.`,
      ],
      ps: (c) => `추신: 저희 분석 기준으로 현재 프로필은 ${r1(c.score)}/10점입니다. 빠르게 올라갈 수 있습니다.`,
    },
    {
      subject: ({ name }) => `${name}을 검색했지만 찾지 못한 손님 이야기`,
      paragraphs: (c) => [
        `안녕하세요, Brandstash의 ${c.sender}입니다.`,
        `지금 이 순간에도 ${c.city}에서 ${c.name}이 제공하는 것을 Google에 검색하는 사람이 있습니다. 그 손님은 어디로 갈까요? 프로필이 더 잘 갖춰진 경쟁 업체입니다. 실력이 사장님보다 못해도 말이죠.`,
        `프로필을 살펴보고(공개 정보만) 이유를 찾았습니다: ${c.f1}.${c.f2 ? ` 그리고: ${c.f2}.` : ''}`,
        `이런 하루하루가 손님을 옆집으로 보내고 있습니다. 다행히 며칠이면 해결됩니다. 그리고 Brandstash가 자동으로 계속 유지합니다.`,
        `2분만 내주시면 어떻게 달라질지 보여드리겠습니다. 이 메일에 답장만 주세요.`,
      ],
      ps: () => `추신: 비밀번호도, 계정 권한도 필요 없습니다. 이미 공개된 정보만 사용합니다.`,
    },
    {
      subject: (c) => (c.rating != null ? `${c.name}의 ${r1(c.rating)}★는 더 알려져야 합니다` : `${c.name}은 Google에서 더 주목받아야 합니다`),
      paragraphs: (c) => [
        c.rating != null
          ? `솔직히 말씀드리면, ${r1(c.rating)}★${c.reviews ? ` (리뷰 ${c.reviews}개)` : ''}는 우연히 만들어지지 않습니다. 진심으로 대단하십니다.`
          : `솔직히 말씀드리면, ${c.name}이 일을 진지하게 하신다는 게 바로 보입니다.`,
        `그런데 Google 프로필이 그 실력을 따라가지 못하고 있습니다: ${c.f1}. 거리에서 제일 좋은 가게인데 쇼윈도 불이 꺼져 있는 셈입니다.`,
        `실력은 사장님 몫입니다. 쇼윈도를 계속 밝혀 두는 일(새 사진, 정확한 시간, 리뷰 답변, 소식 게시)은 Brandstash가 매일 자동으로 합니다.`,
        `${c.name}에 실제로 무엇이 달라질지 보시겠어요? 답장 주시면 보여드립니다. 안 맞으면 그걸로 끝, 부담 없습니다.`,
      ],
      ps: () => `추신: 이 분석은 무료이고 이미 사장님 것입니다. 저희와 함께하지 않으셔도 활용하세요.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `또 저입니다, ${name} :)`,
      paragraphs: (c) => [
        `안녕하세요! 또 저입니다, Brandstash의 ${c.sender}입니다.`,
        `며칠 전 ${c.name}의 Google 프로필에 대해 메일드렸는데요(요약: ${c.f1}). 사업하시느라 얼마나 바쁘신지 알기에 바로 본론만:`,
        `제안은 그대로 유효합니다. 2분이면 무엇부터 고칠지 보여드리고, 결정은 사장님이 하시면 됩니다. “보여주세요”라고 답장만 주세요.`,
      ],
      ps: () => `추신: 지금이 아니라면 “나중에”라고 답해 주세요. 때가 되면 다시 연락드리겠습니다. 부담 드리지 않겠습니다.`,
    },
    {
      subject: ({ name }) => `마지막 메일입니다, 약속드려요, ${name}`,
      paragraphs: (c) => [
        `약속드립니다. 이게 마지막 메일입니다. Brandstash의 ${c.sender}입니다.`,
        `${c.name}의 Google 프로필에 대해 두 번 메일드렸으니, 지금은 때가 아닌 것 같습니다. 정말 괜찮습니다.`,
        `떠나기 전에 선물 하나 드립니다. 프로필에서 가장 먼저 고칠 것은 이것입니다: ${c.f1}. 저희 없이도 이번 주 안에 하시길 권합니다.`,
        `언젠가 프로필이 자동으로 일하게 만들고 싶어지시면, 이 메일에 답장 주세요(유효기간은 없습니다). ${c.name}의 번창을 기원합니다!`,
      ],
    },
  ],
  signoff: '감사합니다.',
}

export const NOTE_PACKS: Record<EmailLanguage, NotePack> = {
  pt, en, es, fr, de, it, 'zh-TW': zhTW, 'zh-HK': zhHK, ja, ko,
}

/* ── findings derivation (data-driven, fully localized) ─────────────────── */

export function buildFindings(
  pack: NotePack,
  summary: Pick<PlaceProfileSummary, 'photos_count' | 'has_hours' | 'editorial_summary' | 'total_ratings'>,
): string[] {
  const out: string[] = []
  // Ordered by scoring weight: photos & reviews weigh 2×, then hours/description.
  if (summary.photos_count === 0) out.push(pack.findings.noPhotos)
  else if (summary.photos_count < 4) out.push(pack.findings.fewPhotos(summary.photos_count))
  if (summary.total_ratings == null || summary.total_ratings === 0) out.push(pack.findings.noReviews)
  else if (summary.total_ratings < 30) out.push(pack.findings.fewReviews(summary.total_ratings))
  if (!summary.has_hours) out.push(pack.findings.noHours)
  if (!summary.editorial_summary) out.push(pack.findings.noDescription)
  if (!out.length) out.push(pack.findings.clean)
  return out
}

/** Deterministic variant choice, never repeating a previously used variant. */
export function pickNoteVariant(placeId: string, used: readonly number[]): number {
  const base = hashString(placeId) % NOTE_VARIANT_COUNT
  for (let i = 0; i < NOTE_VARIANT_COUNT; i++) {
    const candidate = (base + i) % NOTE_VARIANT_COUNT
    if (!used.includes(candidate)) return candidate
  }
  return base
}

/* ── rendering ──────────────────────────────────────────────────────────── */

export type NoteInput = {
  placeId: string
  name: string
  cityLabel: string
  rating: number | null
  reviewCount: number | null
  score: number
  summary: Pick<PlaceProfileSummary, 'photos_count' | 'has_hours' | 'editorial_summary' | 'total_ratings'>
  language: EmailLanguage
  sender: { name: string; email: string }
  unsubscribeUrl: string
  /** 0..NOTE_VARIANT_COUNT-1 — pick with pickNoteVariant. */
  variant: number
  /** 0 = initial note, 1 = bump, 2 = breakup. */
  followupNumber: 0 | 1 | 2
  /**
   * Copy to write with. Defaults to the business-owner pack; the agency pack
   * (notes-agency.ts) pitches the multi-client dashboard instead. Resolved
   * per lead in email/audience.ts.
   */
  pack?: NotePack
  /** Signature line — the sender's own brand (Settings → Offer). */
  brandName?: string
  /**
   * Tracked landing URL (per-send rid) — becomes the "Brandstash" link in
   * the signature (HTML) and a visible URL line (plain text). null = no
   * landing link at all; a bare untracked landing link is never emitted.
   */
  landingUrl?: string | null
}

export type RenderedNote = {
  subject: string
  html: string
  text: string
  variant: number
  followupNumber: number
}

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Personal notes look hand-typed: default client font, no images, no cards. */
const NOTE_FONT = 'Arial, Helvetica, sans-serif'

export function renderNoteEmail(input: NoteInput): RenderedNote {
  const pack = input.pack ?? NOTE_PACKS[input.language] ?? NOTE_PACKS.en
  const labels = (EMAIL_LOCALES[input.language] ?? EMAIL_LOCALES.en).labels
  const variant = ((input.variant % NOTE_VARIANT_COUNT) + NOTE_VARIANT_COUNT) % NOTE_VARIANT_COUNT

  const findings = buildFindings(pack, input.summary)
  // Rotate findings by variant so every send leads with a different hook.
  const rotated = findings.map((_, i) => findings[(i + variant) % findings.length])
  const firstName = input.sender.name.split(/\s+/)[0] || input.sender.name

  const ctx: NoteCtx = {
    name: input.name,
    city: input.cityLabel.split(',')[0].trim(),
    rating: input.rating,
    reviews: input.reviewCount,
    score: input.score,
    f1: rotated[0],
    f2: rotated[1] ?? null,
    sender: firstName,
  }

  const template =
    input.followupNumber === 0 ? pack.variants[variant] : pack.followups[input.followupNumber - 1]

  const subject = template.subject(ctx)
  const paragraphs = template.paragraphs(ctx)
  const ps = template.ps?.(ctx)

  const bodyBlocks = [...paragraphs, ...(ps ? [ps] : [])]

  // Signature link: the natural place a real person links their company —
  // the ONLY landing link in a note, carrying this send's rid.
  const brandName = input.brandName?.trim() || 'Brandstash'
  const brandSignature = input.landingUrl
    ? `<a href="${escHtml(input.landingUrl)}" style="color:#8a8a8a;text-decoration:underline;">${escHtml(brandName)}</a>`
    : `<span style="color:#8a8a8a;">${escHtml(brandName)}</span>`

  const html = `<!doctype html>
<html lang="${input.language}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div style="max-width:560px;margin:0;padding:20px 18px;font-family:${NOTE_FONT};font-size:14.5px;line-height:1.65;color:#1f1f1f;">
    ${bodyBlocks.map((p) => `<p style="margin:0 0 14px;">${escHtml(p)}</p>`).join('\n    ')}
    <p style="margin:22px 0 0;">${escHtml(pack.signoff)}<br>${escHtml(input.sender.name)}<br>${brandSignature}</p>
    <div style="margin-top:30px;padding-top:12px;border-top:1px solid #ececec;font-size:11px;line-height:1.6;color:#9a9a9a;">
      ${escHtml(labels.reasonLine)}<br>
      ${escHtml(labels.assessmentNote)}<br>
      <a href="${escHtml(input.unsubscribeUrl)}" style="color:#9a9a9a;text-decoration:underline;">${escHtml(labels.unsubscribe)}</a>
    </div>
  </div>
</body>
</html>`

  const text = [
    ...bodyBlocks,
    `${pack.signoff}\n${input.sender.name}\n${brandName}${input.landingUrl ? `\n${input.landingUrl}` : ''}`,
    `--\n${labels.reasonLine}\n${labels.assessmentNote}\n${labels.unsubscribe}: ${input.unsubscribeUrl}`,
  ].join('\n\n')

  return { subject, html, text, variant, followupNumber: input.followupNumber }
}
