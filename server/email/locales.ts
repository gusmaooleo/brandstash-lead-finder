/**
 * Email localization packs — natural copy per market, not word-for-word
 * translation. The engine's canonical output stays Portuguese (Brandstash
 * parity); these packs localize the *presentation*: subjects, dashboard
 * labels, opportunity lines, CTA and unsubscribe wording.
 *
 * Subject bands (per spec): Google rating < 4 → improvement-oriented;
 * ≥ 4 → confident retention-oriented. Variants are chosen deterministically
 * by Place-ID hash and the picked index is recorded on the lead.
 */

import type { EmailLanguage } from '../../shared/types'
import type { CategoryKey, CategoryStatus } from '../scoring/rules-dictionary'

export type SubjectVariant = {
  /** Render with the business name and (possibly null) rating. */
  render: (name: string, rating: number | null) => string
  /** Variants that interpolate the rating are skipped when rating is null. */
  needsRating?: boolean
}

export type EmailLocale = {
  lang: EmailLanguage
  subjectsLow: SubjectVariant[]
  subjectsHigh: SubjectVariant[]
  introLow: (name: string, city: string) => string
  introHigh: (name: string, city: string) => string
  labels: {
    reportTag: string
    overallScore: string
    outOfTen: string
    googleRating: string
    reviews: string
    opportunities: string
    statusGood: string
    statusNeedsWork: string
    statusMissing: string
    assessmentNote: string
    /** Bold lead-in of the CTA card: Brandstash does the work FOR the user. */
    autopilotLine: string
    ctaLead: (name: string) => string
    ctaButton: string
    ctaMailSubject: (name: string) => string
    retentionLine: string
    sentBy: string
    unsubscribe: string
    reasonLine: string
  }
  categories: Record<CategoryKey, string>
  opportunities: Record<CategoryKey, Partial<Record<CategoryStatus, string>>>
}

const fmtRating = (rating: number | null): string =>
  rating == null ? '' : String(rating).replace(/^(\d+)$/, '$1.0')

/* ────────────────────────── EN ────────────────────────── */
const en: EmailLocale = {
  lang: 'en',
  subjectsLow: [
    { render: (n, r) => `${n} scored ${fmtRating(r)} on Google — here's how to protect your visibility`, needsRating: true },
    { render: (n) => `Your Google profile has room to grow, ${n}` },
    { render: (n) => `Customers check ${n} on Google before visiting — what do they see?` },
  ],
  subjectsHigh: [
    { render: (n) => `${n} is performing well on Google — keep that visibility working for you` },
    { render: () => `A strong Google score is only useful if you keep it visible` },
    { render: (n, r) => `${n}: your ${fmtRating(r)}★ reputation deserves more reach`, needsRating: true },
  ],
  introLow: (n, city) =>
    `We ran a public visibility check on ${n}'s Google presence in ${city} — and found gaps that are quietly sending your customers to the competitor next door. The good news: every one of them is fixable, fast. Start with the ones below.`,
  introHigh: (n) =>
    `${n} already stands out on Google — that reputation is an asset most businesses would kill for. The next step is making it WORK: turning every search into a visit, before a hungrier competitor catches up.`,
  labels: {
    reportTag: 'Local visibility report',
    overallScore: 'Overall score',
    outOfTen: '/ 10',
    googleRating: 'Google rating',
    reviews: 'reviews',
    opportunities: 'What we found',
    statusGood: 'Good',
    statusNeedsWork: 'Needs work',
    statusMissing: 'Missing',
    assessmentNote:
      'This assessment is based on publicly available information from Google and your website. No account access involved.',
    autopilotLine: 'Brandstash does this for you — on autopilot.',
    ctaLead: (n) =>
      `It plans and publishes your Google updates, keeps every review answered and your profile always complete — automatically, every single day, while you run ${n}. Reply and I'll show you in 2 minutes what it would fix first. Free look, zero commitment.`,
    ctaButton: 'Show me how',
    ctaMailSubject: (n) => `I want to improve ${n}'s local visibility`,
    retentionLine:
      'Your Google presence is in great shape. The challenge now is consistency — keeping reviews, photos and updates active so competitors can’t outrank you.',
    sentBy: 'Sent by',
    unsubscribe: 'Don’t want to hear from us? Unsubscribe',
    reasonLine: 'You received this one-time note because your business is publicly listed on Google.',
  },
  categories: {
    fotos: 'Photos', avaliacoes: 'Reviews', horarios: 'Hours', descricao: 'Description',
    website: 'Website', telefone: 'Phone', categorias: 'Categories', status: 'Status',
  },
  opportunities: {
    fotos: {
      ausente: 'Your profile has no photos — profiles with photos get significantly more views and visits.',
      precisa_melhorar: 'Only a few photos are published. Fresh exterior, interior and team photos build instant trust.',
    },
    avaliacoes: {
      ausente: 'No Google reviews yet — reviews are the #1 trust signal for local customers.',
      precisa_melhorar: 'Review volume and rating can grow — a steady flow of 4★+ reviews drives local choice.',
    },
    horarios: {
      ausente: 'No opening hours listed — customers filter by “open now” and skip profiles without hours.',
      precisa_melhorar: 'Opening hours look incomplete — keep every weekday and holiday exception current.',
    },
    descricao: {
      ausente: 'No business description — a clear summary tells Google and customers exactly what you offer.',
      precisa_melhorar: 'The description is thin — expanding it improves how you rank for what you sell.',
    },
    website: {
      ausente: 'No website linked on the profile — that link is one of the strongest conversion levers.',
      precisa_melhorar: 'Check that the website link is correct and active.',
    },
    telefone: {
      ausente: 'No phone number listed — one tap to call is how local customers reach you.',
      precisa_melhorar: 'Double-check the listed phone number.',
    },
    categorias: {
      ausente: 'No business category set — Google can’t match you to searches without it.',
      precisa_melhorar: 'Only one category set — secondary categories unlock more search matches.',
    },
    status: {
      ausente: 'The profile is marked closed — that’s turning customers away right now.',
      precisa_melhorar: 'The profile status isn’t “operational” — confirm it to avoid losing searches.',
    },
  },
}

/* ────────────────────────── PT ────────────────────────── */
const pt: EmailLocale = {
  lang: 'pt',
  subjectsLow: [
    { render: (n, r) => `${n} está com nota ${fmtRating(r)} no Google — veja como proteger sua visibilidade`, needsRating: true },
    { render: (n) => `Seu perfil no Google tem espaço para crescer, ${n}` },
    { render: (n) => `Clientes pesquisam ${n} no Google antes de visitar — o que eles encontram?` },
  ],
  subjectsHigh: [
    { render: (n) => `${n} vai bem no Google — mantenha essa visibilidade trabalhando por você` },
    { render: () => `Uma boa nota no Google só vale se continuar visível` },
    { render: (n, r) => `${n}: sua reputação ${fmtRating(r)}★ merece mais alcance`, needsRating: true },
  ],
  introLow: (n, city) =>
    `Fizemos uma análise pública da presença de ${n} no Google em ${city} — e encontramos falhas que estão, em silêncio, mandando seus clientes para o concorrente do lado. A boa notícia: todas têm conserto, e rápido. Comece pelas de baixo.`,
  introHigh: (n) =>
    `${n} já se destaca no Google — essa reputação vale ouro. O próximo passo é fazê-la TRABALHAR: transformar cada busca em cliente na porta, antes que um concorrente mais faminto alcance vocês.`,
  labels: {
    reportTag: 'Relatório de visibilidade local',
    overallScore: 'Pontuação geral',
    outOfTen: '/ 10',
    googleRating: 'Nota no Google',
    reviews: 'avaliações',
    opportunities: 'O que encontramos',
    statusGood: 'Bom',
    statusNeedsWork: 'Precisa melhorar',
    statusMissing: 'Ausente',
    assessmentNote:
      'Esta análise usa apenas informações públicas do Google e do seu site. Nenhum acesso à sua conta foi envolvido.',
    autopilotLine: 'O Brandstash faz isso por você — no piloto automático.',
    ctaLead: (n) =>
      `Ele planeja e publica suas atualizações no Google, responde cada avaliação e mantém o perfil sempre completo — automático, todo santo dia, enquanto você toca ${n}. Responda este email e em 2 minutos eu mostro o que ele consertaria primeiro. De graça, sem compromisso.`,
    ctaButton: 'Quero ver como',
    ctaMailSubject: (n) => `Quero melhorar a visibilidade local de ${n}`,
    retentionLine:
      'Sua presença no Google está em ótima forma. O desafio agora é a consistência — manter avaliações, fotos e atualizações ativas para nenhum concorrente ultrapassar você.',
    sentBy: 'Enviado por',
    unsubscribe: 'Não quer receber nossas mensagens? Cancelar',
    reasonLine: 'Você recebeu esta mensagem única porque seu negócio está listado publicamente no Google.',
  },
  categories: {
    fotos: 'Fotos', avaliacoes: 'Avaliações', horarios: 'Horários', descricao: 'Descrição',
    website: 'Website', telefone: 'Telefone', categorias: 'Categorias', status: 'Status',
  },
  opportunities: {
    fotos: {
      ausente: 'Seu perfil está sem fotos — perfis com fotos recebem muito mais visualizações e visitas.',
      precisa_melhorar: 'Poucas fotos publicadas. Imagens recentes de fachada, interior e equipe geram confiança imediata.',
    },
    avaliacoes: {
      ausente: 'Ainda não há avaliações no Google — elas são o principal sinal de confiança para o cliente local.',
      precisa_melhorar: 'Volume e nota das avaliações podem crescer — um fluxo constante de avaliações 4★+ decide a escolha local.',
    },
    horarios: {
      ausente: 'Sem horário de funcionamento — clientes filtram por “aberto agora” e pulam perfis sem horários.',
      precisa_melhorar: 'O horário parece incompleto — mantenha todos os dias e feriados atualizados.',
    },
    descricao: {
      ausente: 'Sem descrição do negócio — um resumo claro diz ao Google e ao cliente exatamente o que você oferece.',
      precisa_melhorar: 'A descrição está curta — ampliá-la melhora como você aparece nas buscas do seu segmento.',
    },
    website: {
      ausente: 'Nenhum site vinculado ao perfil — esse link é uma das maiores alavancas de conversão.',
      precisa_melhorar: 'Confira se o link do site está correto e ativo.',
    },
    telefone: {
      ausente: 'Sem telefone cadastrado — um toque para ligar é como o cliente local chega até você.',
      precisa_melhorar: 'Revise o telefone cadastrado.',
    },
    categorias: {
      ausente: 'Sem categoria definida — o Google não consegue conectar você às buscas sem ela.',
      precisa_melhorar: 'Só uma categoria definida — categorias secundárias liberam mais correspondências de busca.',
    },
    status: {
      ausente: 'O perfil está marcado como fechado — isso afasta clientes agora mesmo.',
      precisa_melhorar: 'O status do perfil não está “em operação” — confirme para não perder buscas.',
    },
  },
}

/* ────────────────────────── ES ────────────────────────── */
const es: EmailLocale = {
  lang: 'es',
  subjectsLow: [
    { render: (n, r) => `${n} tiene ${fmtRating(r)} en Google — así puedes proteger tu visibilidad`, needsRating: true },
    { render: (n) => `Tu perfil de Google tiene margen para crecer, ${n}` },
    { render: (n) => `Los clientes buscan ${n} en Google antes de visitar — ¿qué encuentran?` },
  ],
  subjectsHigh: [
    { render: (n) => `${n} funciona bien en Google — haz que esa visibilidad siga trabajando para ti` },
    { render: () => `Una buena puntuación en Google solo sirve si sigue siendo visible` },
    { render: (n, r) => `${n}: tu reputación de ${fmtRating(r)}★ merece más alcance`, needsRating: true },
  ],
  introLow: (n, city) =>
    `Hicimos un análisis público de la presencia de ${n} en Google en ${city} — y encontramos fallos que, en silencio, están mandando a tus clientes al competidor de al lado. La buena noticia: todos tienen arreglo, y rápido. Empieza por los de abajo.`,
  introHigh: (n) =>
    `${n} ya destaca en Google — esa reputación vale oro. El siguiente paso es ponerla a TRABAJAR: convertir cada búsqueda en un cliente en la puerta, antes de que un competidor con más hambre te alcance.`,
  labels: {
    reportTag: 'Informe de visibilidad local',
    overallScore: 'Puntuación general',
    outOfTen: '/ 10',
    googleRating: 'Valoración en Google',
    reviews: 'reseñas',
    opportunities: 'Lo que encontramos',
    statusGood: 'Bien',
    statusNeedsWork: 'Mejorable',
    statusMissing: 'Ausente',
    assessmentNote:
      'Este análisis se basa únicamente en información pública de Google y de tu sitio web. No implica ningún acceso a tu cuenta.',
    autopilotLine: 'Brandstash lo hace por ti — en piloto automático.',
    ctaLead: (n) =>
      `Planifica y publica tus novedades en Google, responde cada reseña y mantiene tu perfil siempre completo — automático, todos los días, mientras tú te ocupas de ${n}. Responde este correo y en 2 minutos te muestro qué arreglaría primero. Gratis, sin compromiso.`,
    ctaButton: 'Quiero verlo',
    ctaMailSubject: (n) => `Quiero mejorar la visibilidad local de ${n}`,
    retentionLine:
      'Tu presencia en Google está en plena forma. El reto ahora es la consistencia: mantener reseñas, fotos y novedades activas para que ningún competidor te supere.',
    sentBy: 'Enviado por',
    unsubscribe: '¿No quieres recibir más mensajes? Darse de baja',
    reasonLine: 'Recibes esta nota única porque tu negocio aparece públicamente en Google.',
  },
  categories: {
    fotos: 'Fotos', avaliacoes: 'Reseñas', horarios: 'Horarios', descricao: 'Descripción',
    website: 'Sitio web', telefone: 'Teléfono', categorias: 'Categorías', status: 'Estado',
  },
  opportunities: {
    fotos: {
      ausente: 'Tu perfil no tiene fotos — los perfiles con fotos reciben muchas más visitas.',
      precisa_melhorar: 'Hay pocas fotos publicadas. Imágenes recientes de fachada, interior y equipo generan confianza inmediata.',
    },
    avaliacoes: {
      ausente: 'Aún no hay reseñas en Google — son la señal de confianza nº1 para el cliente local.',
      precisa_melhorar: 'El volumen y la nota de reseñas pueden crecer — un flujo constante de reseñas 4★+ decide la elección local.',
    },
    horarios: {
      ausente: 'Sin horario publicado — los clientes filtran por “abierto ahora” y descartan perfiles sin horario.',
      precisa_melhorar: 'El horario parece incompleto — mantén todos los días y festivos al día.',
    },
    descricao: {
      ausente: 'Sin descripción del negocio — un resumen claro le dice a Google y al cliente qué ofreces.',
      precisa_melhorar: 'La descripción es breve — ampliarla mejora cómo apareces en las búsquedas de tu sector.',
    },
    website: {
      ausente: 'No hay sitio web vinculado al perfil — ese enlace es una de las mayores palancas de conversión.',
      precisa_melhorar: 'Comprueba que el enlace del sitio web sea correcto y esté activo.',
    },
    telefone: {
      ausente: 'Sin teléfono publicado — una llamada con un toque es como te encuentra el cliente local.',
      precisa_melhorar: 'Revisa el teléfono publicado.',
    },
    categorias: {
      ausente: 'Sin categoría definida — Google no puede conectarte con las búsquedas sin ella.',
      precisa_melhorar: 'Solo una categoría definida — las secundarias desbloquean más coincidencias de búsqueda.',
    },
    status: {
      ausente: 'El perfil figura como cerrado — eso está alejando clientes ahora mismo.',
      precisa_melhorar: 'El estado del perfil no es “operativo” — confírmalo para no perder búsquedas.',
    },
  },
}

/* ────────────────────────── FR ────────────────────────── */
const fr: EmailLocale = {
  lang: 'fr',
  subjectsLow: [
    { render: (n, r) => `${n} affiche ${fmtRating(r)} sur Google — voici comment protéger votre visibilité`, needsRating: true },
    { render: (n) => `Votre profil Google a un vrai potentiel de croissance, ${n}` },
    { render: (n) => `Vos clients consultent ${n} sur Google avant de venir — que voient-ils ?` },
  ],
  subjectsHigh: [
    { render: (n) => `${n} performe bien sur Google — faites travailler cette visibilité pour vous` },
    { render: () => `Une bonne note Google n’a de valeur que si elle reste visible` },
    { render: (n, r) => `${n} : votre réputation ${fmtRating(r)}★ mérite plus de portée`, needsRating: true },
  ],
  introLow: (n, city) =>
    `Nous avons analysé la présence Google publique de ${n} à ${city} — et relevé des lacunes qui, en silence, envoient vos clients chez le concurrent d'à côté. La bonne nouvelle : tout se corrige, et vite. Commencez par les points ci-dessous.`,
  introHigh: (n) =>
    `${n} se distingue déjà sur Google — cette réputation vaut de l'or. L'étape suivante : la faire TRAVAILLER, transformer chaque recherche en client qui pousse la porte, avant qu'un concurrent plus affamé ne vous rattrape.`,
  labels: {
    reportTag: 'Rapport de visibilité locale',
    overallScore: 'Score global',
    outOfTen: '/ 10',
    googleRating: 'Note Google',
    reviews: 'avis',
    opportunities: 'Ce que nous avons relevé',
    statusGood: 'Bon',
    statusNeedsWork: 'À améliorer',
    statusMissing: 'Manquant',
    assessmentNote:
      'Cette analyse repose uniquement sur des informations publiques de Google et de votre site. Aucun accès à votre compte.',
    autopilotLine: 'Brandstash le fait pour vous — en pilote automatique.',
    ctaLead: (n) =>
      `Il planifie et publie vos actualités Google, répond à chaque avis et garde votre fiche toujours complète — automatiquement, chaque jour, pendant que vous faites tourner ${n}. Répondez à cet e-mail : en 2 minutes, je vous montre ce qu'il corrigerait en premier. Gratuit, sans engagement.`,
    ctaButton: 'Montrez-moi',
    ctaMailSubject: (n) => `Je veux améliorer la visibilité locale de ${n}`,
    retentionLine:
      'Votre présence Google est en excellente forme. Le défi désormais : la régularité — avis, photos et mises à jour actives pour ne laisser aucun concurrent vous dépasser.',
    sentBy: 'Envoyé par',
    unsubscribe: 'Vous ne souhaitez plus nous lire ? Se désinscrire',
    reasonLine: 'Vous recevez ce message unique car votre établissement est répertorié publiquement sur Google.',
  },
  categories: {
    fotos: 'Photos', avaliacoes: 'Avis', horarios: 'Horaires', descricao: 'Description',
    website: 'Site web', telefone: 'Téléphone', categorias: 'Catégories', status: 'Statut',
  },
  opportunities: {
    fotos: {
      ausente: 'Votre profil n’a aucune photo — les profils avec photos reçoivent nettement plus de visites.',
      precisa_melhorar: 'Peu de photos publiées. Des images récentes de la devanture, de l’intérieur et de l’équipe inspirent immédiatement confiance.',
    },
    avaliacoes: {
      ausente: 'Aucun avis Google pour l’instant — c’est le premier signal de confiance des clients locaux.',
      precisa_melhorar: 'Le volume et la note des avis peuvent progresser — un flux régulier d’avis 4★+ oriente le choix local.',
    },
    horarios: {
      ausente: 'Aucun horaire renseigné — les clients filtrent par « ouvert maintenant » et ignorent les profils sans horaires.',
      precisa_melhorar: 'Les horaires semblent incomplets — tenez à jour chaque jour et les exceptions de jours fériés.',
    },
    descricao: {
      ausente: 'Pas de description — un résumé clair dit à Google et à vos clients exactement ce que vous proposez.',
      precisa_melhorar: 'La description est courte — l’étoffer améliore votre positionnement sur vos requêtes.',
    },
    website: {
      ausente: 'Aucun site web relié au profil — ce lien est l’un des plus puissants leviers de conversion.',
      precisa_melhorar: 'Vérifiez que le lien du site est correct et actif.',
    },
    telefone: {
      ausente: 'Aucun numéro affiché — l’appel en un geste est le premier réflexe du client local.',
      precisa_melhorar: 'Vérifiez le numéro affiché.',
    },
    categorias: {
      ausente: 'Aucune catégorie définie — sans elle, Google ne peut pas vous associer aux recherches.',
      precisa_melhorar: 'Une seule catégorie définie — les catégories secondaires débloquent plus de correspondances.',
    },
    status: {
      ausente: 'Le profil est marqué comme fermé — cela détourne des clients en ce moment même.',
      precisa_melhorar: 'Le statut du profil n’est pas « en activité » — confirmez-le pour ne pas perdre de recherches.',
    },
  },
}

/* ────────────────────────── DE ────────────────────────── */
const de: EmailLocale = {
  lang: 'de',
  subjectsLow: [
    { render: (n, r) => `${n} steht bei ${fmtRating(r)} auf Google — so schützen Sie Ihre Sichtbarkeit`, needsRating: true },
    { render: (n) => `Ihr Google-Profil hat Luft nach oben, ${n}` },
    { render: (n) => `Kunden prüfen ${n} auf Google, bevor sie kommen — was sehen sie dort?` },
  ],
  subjectsHigh: [
    { render: (n) => `${n} steht gut da auf Google — lassen Sie diese Sichtbarkeit für sich arbeiten` },
    { render: () => `Eine starke Google-Bewertung nützt nur, wenn sie sichtbar bleibt` },
    { render: (n, r) => `${n}: Ihre ${fmtRating(r)}★-Reputation verdient mehr Reichweite`, needsRating: true },
  ],
  introLow: (n, city) =>
    `Wir haben die öffentliche Google-Präsenz von ${n} in ${city} analysiert — und Lücken gefunden, die Ihre Kundschaft still und leise zum Wettbewerber nebenan schicken. Die gute Nachricht: Alles davon ist schnell behoben. Beginnen Sie mit den Punkten unten.`,
  introHigh: (n) =>
    `${n} überzeugt bereits auf Google — diese Reputation ist bares Geld wert. Der nächste Schritt: Sie ARBEITEN lassen. Jede Suche soll zu einem Kunden an der Tür werden, bevor ein hungrigerer Wettbewerber aufholt.`,
  labels: {
    reportTag: 'Lokaler Sichtbarkeits-Report',
    overallScore: 'Gesamtscore',
    outOfTen: '/ 10',
    googleRating: 'Google-Bewertung',
    reviews: 'Rezensionen',
    opportunities: 'Das haben wir gefunden',
    statusGood: 'Gut',
    statusNeedsWork: 'Ausbaufähig',
    statusMissing: 'Fehlt',
    assessmentNote:
      'Diese Auswertung basiert ausschließlich auf öffentlich verfügbaren Informationen von Google und Ihrer Website. Kein Kontozugriff.',
    autopilotLine: 'Brandstash erledigt das für Sie — im Autopilot.',
    ctaLead: (n) =>
      `Es plant und veröffentlicht Ihre Google-Updates, beantwortet jede Rezension und hält Ihr Profil stets vollständig — automatisch, jeden Tag, während Sie ${n} führen. Antworten Sie auf diese E-Mail: In 2 Minuten zeige ich Ihnen, was zuerst behoben würde. Kostenlos, unverbindlich.`,
    ctaButton: 'Zeigen Sie mir wie',
    ctaMailSubject: (n) => `Ich möchte die lokale Sichtbarkeit von ${n} verbessern`,
    retentionLine:
      'Ihre Google-Präsenz ist in Bestform. Die Herausforderung ist jetzt Beständigkeit — Rezensionen, Fotos und Updates aktiv halten, damit kein Wettbewerber vorbeizieht.',
    sentBy: 'Gesendet von',
    unsubscribe: 'Keine weiteren Nachrichten gewünscht? Abmelden',
    reasonLine: 'Sie erhalten diese einmalige Nachricht, weil Ihr Betrieb öffentlich auf Google gelistet ist.',
  },
  categories: {
    fotos: 'Fotos', avaliacoes: 'Rezensionen', horarios: 'Öffnungszeiten', descricao: 'Beschreibung',
    website: 'Website', telefone: 'Telefon', categorias: 'Kategorien', status: 'Status',
  },
  opportunities: {
    fotos: {
      ausente: 'Ihr Profil hat keine Fotos — Profile mit Fotos erhalten deutlich mehr Aufrufe und Besuche.',
      precisa_melhorar: 'Nur wenige Fotos veröffentlicht. Aktuelle Bilder von Außenansicht, Innenraum und Team schaffen sofort Vertrauen.',
    },
    avaliacoes: {
      ausente: 'Noch keine Google-Rezensionen — sie sind das wichtigste Vertrauenssignal für lokale Kundschaft.',
      precisa_melhorar: 'Anzahl und Note der Rezensionen können wachsen — ein stetiger Fluss von 4★+-Bewertungen entscheidet die lokale Wahl.',
    },
    horarios: {
      ausente: 'Keine Öffnungszeiten hinterlegt — Kunden filtern nach „jetzt geöffnet“ und überspringen Profile ohne Zeiten.',
      precisa_melhorar: 'Die Öffnungszeiten wirken unvollständig — halten Sie alle Wochentage und Feiertage aktuell.',
    },
    descricao: {
      ausente: 'Keine Unternehmensbeschreibung — eine klare Zusammenfassung sagt Google und Kunden genau, was Sie bieten.',
      precisa_melhorar: 'Die Beschreibung ist knapp — mehr Substanz verbessert Ihr Ranking für Ihre Leistungen.',
    },
    website: {
      ausente: 'Keine Website im Profil verlinkt — dieser Link ist einer der stärksten Conversion-Hebel.',
      precisa_melhorar: 'Prüfen Sie, ob der Website-Link korrekt und aktiv ist.',
    },
    telefone: {
      ausente: 'Keine Telefonnummer hinterlegt — ein Tipp zum Anrufen ist der Weg, wie lokale Kunden Sie erreichen.',
      precisa_melhorar: 'Prüfen Sie die hinterlegte Telefonnummer.',
    },
    categorias: {
      ausente: 'Keine Kategorie festgelegt — ohne sie kann Google Sie keinen Suchanfragen zuordnen.',
      precisa_melhorar: 'Nur eine Kategorie festgelegt — Zusatzkategorien erschließen weitere Suchtreffer.',
    },
    status: {
      ausente: 'Das Profil ist als geschlossen markiert — das schickt Kundschaft gerade jetzt weg.',
      precisa_melhorar: 'Der Profilstatus ist nicht „in Betrieb“ — bestätigen Sie ihn, um keine Suchen zu verlieren.',
    },
  },
}

/* ────────────────────────── IT ────────────────────────── */
const it: EmailLocale = {
  lang: 'it',
  subjectsLow: [
    { render: (n, r) => `${n} ha ${fmtRating(r)} su Google — ecco come proteggere la tua visibilità`, needsRating: true },
    { render: (n) => `Il tuo profilo Google ha margini di crescita, ${n}` },
    { render: (n) => `I clienti controllano ${n} su Google prima di venire — cosa trovano?` },
  ],
  subjectsHigh: [
    { render: (n) => `${n} va forte su Google — fai lavorare quella visibilità per te` },
    { render: () => `Un buon punteggio su Google vale solo se resta visibile` },
    { render: (n, r) => `${n}: la tua reputazione da ${fmtRating(r)}★ merita più portata`, needsRating: true },
  ],
  introLow: (n, city) =>
    `Abbiamo analizzato la presenza pubblica di ${n} su Google a ${city} — e trovato lacune che, in silenzio, mandano i vostri clienti dal concorrente accanto. La buona notizia: si sistemano tutte, e in fretta. Partite da quelle qui sotto.`,
  introHigh: (n) =>
    `${n} si distingue già su Google — quella reputazione vale oro. Il prossimo passo è farla LAVORARE: trasformare ogni ricerca in un cliente alla porta, prima che un concorrente più affamato vi raggiunga.`,
  labels: {
    reportTag: 'Report di visibilità locale',
    overallScore: 'Punteggio complessivo',
    outOfTen: '/ 10',
    googleRating: 'Valutazione Google',
    reviews: 'recensioni',
    opportunities: 'Cosa abbiamo trovato',
    statusGood: 'Buono',
    statusNeedsWork: 'Da migliorare',
    statusMissing: 'Assente',
    assessmentNote:
      'Questa analisi si basa esclusivamente su informazioni pubbliche di Google e del tuo sito. Nessun accesso al tuo account.',
    autopilotLine: 'Brandstash lo fa per te — con il pilota automatico.',
    ctaLead: (n) =>
      `Pianifica e pubblica i tuoi aggiornamenti su Google, risponde a ogni recensione e tiene il profilo sempre completo — in automatico, ogni giorno, mentre tu mandi avanti ${n}. Rispondi a questa email: in 2 minuti ti mostro cosa sistemerebbe per primo. Gratis, senza impegno.`,
    ctaButton: 'Fammi vedere',
    ctaMailSubject: (n) => `Voglio migliorare la visibilità locale di ${n}`,
    retentionLine:
      'La tua presenza su Google è in ottima forma. La sfida ora è la costanza: recensioni, foto e aggiornamenti sempre attivi, perché nessun concorrente ti superi.',
    sentBy: 'Inviato da',
    unsubscribe: 'Non vuoi più ricevere messaggi? Annulla l’iscrizione',
    reasonLine: 'Ricevi questo messaggio una tantum perché la tua attività è elencata pubblicamente su Google.',
  },
  categories: {
    fotos: 'Foto', avaliacoes: 'Recensioni', horarios: 'Orari', descricao: 'Descrizione',
    website: 'Sito web', telefone: 'Telefono', categorias: 'Categorie', status: 'Stato',
  },
  opportunities: {
    fotos: {
      ausente: 'Il profilo non ha foto — i profili con foto ricevono molte più visualizzazioni e visite.',
      precisa_melhorar: 'Poche foto pubblicate. Immagini recenti di esterni, interni e team creano fiducia immediata.',
    },
    avaliacoes: {
      ausente: 'Ancora nessuna recensione su Google — sono il segnale di fiducia nº1 per il cliente locale.',
      precisa_melhorar: 'Volume e voto delle recensioni possono crescere — un flusso costante di recensioni 4★+ guida la scelta locale.',
    },
    horarios: {
      ausente: 'Nessun orario indicato — i clienti filtrano per “aperto ora” e saltano i profili senza orari.',
      precisa_melhorar: 'Gli orari sembrano incompleti — tieni aggiornati tutti i giorni e le festività.',
    },
    descricao: {
      ausente: 'Nessuna descrizione — un riepilogo chiaro dice a Google e ai clienti esattamente cosa offri.',
      precisa_melhorar: 'La descrizione è scarna — ampliarla migliora il posizionamento sulle tue ricerche.',
    },
    website: {
      ausente: 'Nessun sito collegato al profilo — quel link è una delle leve di conversione più forti.',
      precisa_melhorar: 'Verifica che il link del sito sia corretto e attivo.',
    },
    telefone: {
      ausente: 'Nessun numero di telefono — una chiamata con un tocco è il modo in cui il cliente locale ti raggiunge.',
      precisa_melhorar: 'Controlla il numero indicato.',
    },
    categorias: {
      ausente: 'Nessuna categoria impostata — senza, Google non può abbinarti alle ricerche.',
      precisa_melhorar: 'Una sola categoria impostata — le categorie secondarie sbloccano altre corrispondenze.',
    },
    status: {
      ausente: 'Il profilo risulta chiuso — sta allontanando clienti proprio ora.',
      precisa_melhorar: 'Lo stato del profilo non è “operativo” — confermalo per non perdere ricerche.',
    },
  },
}

/* ────────────────────────── ZH-TW (Mandarin, Traditional) ────────────────────────── */
const zhTW: EmailLocale = {
  lang: 'zh-TW',
  subjectsLow: [
    { render: (n, r) => `${n} 在 Google 上的評分是 ${fmtRating(r)} — 這樣守住您的曝光度`, needsRating: true },
    { render: (n) => `${n}，您的 Google 商家檔案還有成長空間` },
    { render: (n) => `顧客上門前都會先在 Google 搜尋「${n}」— 他們看到了什麼？` },
  ],
  subjectsHigh: [
    { render: (n) => `${n} 在 Google 上表現亮眼 — 讓這份曝光持續為您帶來生意` },
    { render: () => `Google 高評分，唯有持續曝光才有價值` },
    { render: (n, r) => `${n}：${fmtRating(r)}★ 的好口碑值得被更多人看見`, needsRating: true },
  ],
  introLow: (n, city) =>
    `我們針對 ${n} 在${city}的 Google 公開曝光做了檢測 — 發現幾個正在悄悄把顧客送到隔壁對手的缺口。好消息是：每一項都能快速修正。就從下面開始。`,
  introHigh: (n) =>
    `${n} 在 Google 上已經相當出色 — 這份口碑價值連城。下一步是讓它替您「工作」：把每一次搜尋都變成上門的顧客，別讓更積極的對手迎頭趕上。`,
  labels: {
    reportTag: '在地曝光報告',
    overallScore: '總體評分',
    outOfTen: '/ 10',
    googleRating: 'Google 評分',
    reviews: '則評論',
    opportunities: '我們的發現',
    statusGood: '良好',
    statusNeedsWork: '待加強',
    statusMissing: '未設定',
    assessmentNote: '本分析僅使用 Google 與貴店網站上公開的資訊，不涉及任何帳戶存取。',
    autopilotLine: 'Brandstash 全自動替您完成這些工作。',
    ctaLead: (n) => `它會替您規劃並發布 Google 動態、回覆每一則評論、讓商家檔案永遠完整 — 全自動、天天執行，您只要專心經營${n}。回覆這封信，2 分鐘內我讓您看看它會先修正什麼。免費，零承諾。`,
    ctaButton: '了解做法',
    ctaMailSubject: (n) => `我想提升 ${n} 的在地曝光`,
    retentionLine: '您的 Google 曝光狀態極佳。接下來的挑戰是持續經營 — 讓評論、相片與更新保持活躍，不給競爭對手任何超車機會。',
    sentBy: '寄件者',
    unsubscribe: '不想再收到來信？取消訂閱',
    reasonLine: '您會收到這封一次性郵件，是因為貴店已公開刊登於 Google。',
  },
  categories: {
    fotos: '相片', avaliacoes: '評論', horarios: '營業時間', descricao: '商家描述',
    website: '網站', telefone: '電話', categorias: '類別', status: '營業狀態',
  },
  opportunities: {
    fotos: {
      ausente: '商家檔案沒有任何相片 — 有相片的檔案獲得的瀏覽與到訪明顯更多。',
      precisa_melhorar: '目前相片偏少。門面、內部與團隊的近期相片能立即建立信任感。',
    },
    avaliacoes: {
      ausente: '目前還沒有 Google 評論 — 評論是本地顧客最重要的信任訊號。',
      precisa_melhorar: '評論數量與評分還有成長空間 — 穩定累積 4★ 以上的評論會左右顧客的選擇。',
    },
    horarios: {
      ausente: '未設定營業時間 — 顧客常用「營業中」篩選，沒有時間的檔案直接被略過。',
      precisa_melhorar: '營業時間似乎不完整 — 請維持每一天與國定假日的資訊都是最新的。',
    },
    descricao: {
      ausente: '沒有商家描述 — 清楚的介紹能讓 Google 與顧客準確了解您提供什麼。',
      precisa_melhorar: '商家描述偏簡短 — 補充內容能改善您在相關搜尋中的表現。',
    },
    website: {
      ausente: '檔案未連結網站 — 這個連結是最有力的轉換管道之一。',
      precisa_melhorar: '請確認網站連結正確且可正常開啟。',
    },
    telefone: {
      ausente: '未刊登電話號碼 — 一鍵撥號是本地顧客找上您的方式。',
      precisa_melhorar: '請再次確認刊登的電話號碼。',
    },
    categorias: {
      ausente: '尚未設定商家類別 — 少了它，Google 無法把您配對給搜尋的顧客。',
      precisa_melhorar: '只設定了一個類別 — 增加次要類別能帶來更多搜尋曝光。',
    },
    status: {
      ausente: '檔案目前標示為已停業 — 這正在把顧客往外推。',
      precisa_melhorar: '檔案狀態不是「營業中」— 請確認狀態以免流失搜尋。',
    },
  },
}

/* ────────────────────────── ZH-HK (Cantonese, Traditional) ────────────────────────── */
const zhHK: EmailLocale = {
  lang: 'zh-HK',
  subjectsLow: [
    { render: (n, r) => `${n} 喺 Google 嘅評分係 ${fmtRating(r)} — 教您點樣守住曝光度`, needsRating: true },
    { render: (n) => `${n}，您嘅 Google 商家檔案仲有好大進步空間` },
    { render: (n) => `客人幫襯之前都會先 Google 搜尋「${n}」— 佢哋見到啲乜？` },
  ],
  subjectsHigh: [
    { render: (n) => `${n} 喺 Google 表現出色 — 令呢份曝光持續幫您帶客` },
    { render: () => `Google 高評分，要持續俾人見到先有用` },
    { render: (n, r) => `${n}：${fmtRating(r)}★ 嘅好口碑值得俾更多人睇到`, needsRating: true },
  ],
  introLow: (n, city) =>
    `我哋為 ${n} 喺${city}嘅 Google 公開曝光做咗檢測 — 發現幾個缺口，靜靜雞咁將您啲客送咗去隔籬對手度。好消息係：每一項都可以好快執好。就由下面開始。`,
  introHigh: (n) =>
    `${n} 喺 Google 已經好突出 — 呢份口碑好值錢。下一步係令佢幫您「做嘢」：每一次搜尋都變成上門嘅客，唔好俾更進取嘅對手追上。`,
  labels: {
    reportTag: '本地曝光報告',
    overallScore: '總體評分',
    outOfTen: '/ 10',
    googleRating: 'Google 評分',
    reviews: '則評論',
    opportunities: '我哋嘅發現',
    statusGood: '良好',
    statusNeedsWork: '有待改善',
    statusMissing: '未設定',
    assessmentNote: '呢份分析只採用 Google 同貴店網站上公開嘅資料，唔涉及任何帳戶存取。',
    autopilotLine: 'Brandstash 全自動幫您搞掂呢啲工作。',
    ctaLead: (n) => `佢會幫您規劃同發布 Google 動態、回覆每一個評論、令商家檔案長期齊整 — 全自動、日日做，您只需要專心打理${n}。覆呢封email，2 分鐘我show您佢會先執乜嘢。免費，零承諾。`,
    ctaButton: '想知點做',
    ctaMailSubject: (n) => `我想提升 ${n} 嘅本地曝光`,
    retentionLine: '您嘅 Google 曝光狀態非常好。而家嘅挑戰係持續經營 — 令評論、相片同更新保持活躍，唔俾對手有機可乘。',
    sentBy: '寄件人',
    unsubscribe: '唔想再收到我哋嘅電郵？取消訂閱',
    reasonLine: '您收到呢封一次性電郵，係因為貴店已經公開列喺 Google 上面。',
  },
  categories: {
    fotos: '相片', avaliacoes: '評論', horarios: '營業時間', descricao: '商家介紹',
    website: '網站', telefone: '電話', categorias: '類別', status: '營業狀態',
  },
  opportunities: {
    fotos: {
      ausente: '商家檔案冇任何相片 — 有相片嘅檔案瀏覽量同到訪率明顯高好多。',
      precisa_melhorar: '相片偏少。門面、店內同團隊嘅近期相片可以即刻建立信任。',
    },
    avaliacoes: {
      ausente: '暫時未有 Google 評論 — 評論係本地客最重要嘅信任訊號。',
      precisa_melhorar: '評論數量同評分仲有得升 — 穩定累積 4★ 以上嘅評論會直接影響客人揀邊間。',
    },
    horarios: {
      ausente: '未設定營業時間 — 客人成日用「營業中」篩選，冇時間嘅檔案會直接被略過。',
      precisa_melhorar: '營業時間似乎唔完整 — 記得保持每日同公眾假期嘅資料最新。',
    },
    descricao: {
      ausente: '冇商家介紹 — 清晰嘅介紹令 Google 同客人一睇就明您做乜。',
      precisa_melhorar: '商家介紹偏短 — 補充內容可以改善相關搜尋嘅表現。',
    },
    website: {
      ausente: '檔案未連結網站 — 呢條連結係其中一個最強嘅轉換渠道。',
      precisa_melhorar: '請確認網站連結正確、可以正常打開。',
    },
    telefone: {
      ausente: '未列出電話號碼 — 一撳即打係本地客搵您嘅方法。',
      precisa_melhorar: '請覆核列出嘅電話號碼。',
    },
    categorias: {
      ausente: '未設定商家類別 — 冇咗佢，Google 冇辦法將您配對俾搜尋緊嘅客人。',
      precisa_melhorar: '只設定咗一個類別 — 加返次要類別可以帶到更多搜尋曝光。',
    },
    status: {
      ausente: '檔案而家標示為已結業 — 呢一刻就趕緊趕走緊您嘅客。',
      precisa_melhorar: '檔案狀態唔係「營業中」— 請確認返，以免流失搜尋。',
    },
  },
}

/* ────────────────────────── JA ────────────────────────── */
const ja: EmailLocale = {
  lang: 'ja',
  subjectsLow: [
    { render: (n, r) => `${n}様のGoogle評価は${fmtRating(r)} — 集客力を守る方法をご案内します`, needsRating: true },
    { render: (n) => `${n}様、Googleビジネスプロフィールにはまだ伸びしろがあります` },
    { render: (n) => `お客様は来店前に「${n}」をGoogleで検索しています — 何が表示されていますか?` },
  ],
  subjectsHigh: [
    { render: (n) => `${n}様はGoogleで好調です — その存在感を集客につなげ続けましょう` },
    { render: () => `Googleの高評価は、見られ続けてこそ価値があります` },
    { render: (n, r) => `${n}様:${fmtRating(r)}★の評判は、もっと多くの人に届くべきです`, needsRating: true },
  ],
  introLow: (n, city) =>
    `${city}の${n}様について、Google上の公開情報をもとに集客力を診断しました。結果、気づかぬうちにお客様を近隣の競合へ流している「穴」が見つかりました。朗報です — どれも短期間で塞げます。まずは下記からです。`,
  introHigh: (n) =>
    `${n}様はすでにGoogleで存在感を発揮しています — この評判は大きな資産です。次の一手は、それを「働かせる」こと。検索の一つひとつを来店につなげ、追い上げる競合に隙を与えないことです。`,
  labels: {
    reportTag: 'ローカル集客レポート',
    overallScore: '総合スコア',
    outOfTen: '/ 10',
    googleRating: 'Google評価',
    reviews: '件のクチコミ',
    opportunities: '診断結果',
    statusGood: '良好',
    statusNeedsWork: '要改善',
    statusMissing: '未設定',
    assessmentNote: 'この診断はGoogleと貴店ウェブサイトの公開情報のみに基づいています。アカウントへのアクセスは一切行っていません。',
    autopilotLine: 'Brandstashが、すべて自動で代行します。',
    ctaLead: (n) => `Google投稿の企画・公開、すべてのクチコミへの返信、プロフィールの完全な状態の維持まで — 毎日、すべて自動。${n}様は本業に集中するだけです。このメールにご返信いただければ、2分で「まず何が直るか」をお見せします。無料・無条件です。`,
    ctaButton: '詳しく見る',
    ctaMailSubject: (n) => `${n}のローカル集客を改善したい`,
    retentionLine: '貴店のGoogle上のプレゼンスは非常に良好です。これからの課題は継続 — クチコミ・写真・更新を絶やさず、競合に追い抜かれない状態を保つことです。',
    sentBy: '送信者',
    unsubscribe: '今後の配信が不要な場合は 配信停止',
    reasonLine: 'このメールは、貴店がGoogleに公開掲載されているため、一度限りお送りしています。',
  },
  categories: {
    fotos: '写真', avaliacoes: 'クチコミ', horarios: '営業時間', descricao: '説明文',
    website: 'ウェブサイト', telefone: '電話番号', categorias: 'カテゴリ', status: '営業状態',
  },
  opportunities: {
    fotos: {
      ausente: 'プロフィールに写真がありません — 写真のあるプロフィールは閲覧数・来店数が大きく伸びます。',
      precisa_melhorar: '写真が少なめです。外観・店内・スタッフの最新写真は、その場で信頼を生みます。',
    },
    avaliacoes: {
      ausente: 'Googleのクチコミがまだありません — クチコミは地域のお客様にとって最大の信頼材料です。',
      precisa_melhorar: 'クチコミの件数と評価はまだ伸ばせます — 4★以上のクチコミが継続的に集まる状態が、お店選びを左右します。',
    },
    horarios: {
      ausente: '営業時間が未設定です — お客様は「営業中」で絞り込むため、時間のないプロフィールは選ばれません。',
      precisa_melhorar: '営業時間が不完全のようです — 曜日ごと・祝日の例外まで最新に保ちましょう。',
    },
    descricao: {
      ausente: '店舗の説明文がありません — 明確な紹介文は、Googleとお客様に提供内容を正しく伝えます。',
      precisa_melhorar: '説明文が短めです — 内容を充実させると、関連検索での見つかりやすさが向上します。',
    },
    website: {
      ausente: 'プロフィールにウェブサイトが未登録です — このリンクは最も強力な導線のひとつです。',
      precisa_melhorar: 'ウェブサイトのリンクが正しく機能しているかご確認ください。',
    },
    telefone: {
      ausente: '電話番号が未掲載です — ワンタップ発信が、地域のお客様との最短の接点です。',
      precisa_melhorar: '掲載中の電話番号をご確認ください。',
    },
    categorias: {
      ausente: 'ビジネスカテゴリが未設定です — 設定がないと、Googleは検索と貴店を結び付けられません。',
      precisa_melhorar: 'カテゴリが1つだけです — サブカテゴリの追加で、より多くの検索にヒットします。',
    },
    status: {
      ausente: 'プロフィールが「閉業」と表示されています — 今この瞬間もお客様を遠ざけています。',
      precisa_melhorar: 'プロフィールの状態が「営業中」ではありません — 機会損失を防ぐためご確認ください。',
    },
  },
}

/* ────────────────────────── KO ────────────────────────── */
const ko: EmailLocale = {
  lang: 'ko',
  subjectsLow: [
    { render: (n, r) => `${n}의 Google 평점은 ${fmtRating(r)}점 — 노출을 지키는 방법을 알려드립니다`, needsRating: true },
    { render: (n) => `${n}님, Google 비즈니스 프로필에 성장 여지가 있습니다` },
    { render: (n) => `고객은 방문 전에 Google에서 ‘${n}’을 검색합니다 — 무엇이 보일까요?` },
  ],
  subjectsHigh: [
    { render: (n) => `${n}은 Google에서 좋은 성과를 내고 있습니다 — 그 노출이 계속 일하게 하세요` },
    { render: () => `높은 Google 평점도 계속 보여야 가치가 있습니다` },
    { render: (n, r) => `${n}: ${fmtRating(r)}★ 평판은 더 많이 알려질 자격이 있습니다`, needsRating: true },
  ],
  introLow: (n, city) =>
    `${city}의 ${n}에 대해 Google 공개 정보를 기반으로 노출 진단을 진행했습니다. 그 결과, 모르는 사이에 손님을 옆집 경쟁 업체로 보내고 있는 빈틈이 발견되었습니다. 다행히 전부 빠르게 메울 수 있습니다 — 아래 항목부터 시작하세요.`,
  introHigh: (n) =>
    `${n}은 이미 Google에서 돋보입니다 — 이 평판은 큰 자산입니다. 다음 단계는 그것을 ‘일하게’ 만드는 것: 검색 하나하나를 방문 고객으로 바꾸고, 더 빠르게 움직이는 경쟁자에게 틈을 주지 않는 것입니다.`,
  labels: {
    reportTag: '지역 노출 리포트',
    overallScore: '종합 점수',
    outOfTen: '/ 10',
    googleRating: 'Google 평점',
    reviews: '개 리뷰',
    opportunities: '진단 결과',
    statusGood: '양호',
    statusNeedsWork: '개선 필요',
    statusMissing: '미설정',
    assessmentNote: '이 진단은 Google과 귀사 웹사이트의 공개 정보만을 기반으로 하며, 계정 접근은 전혀 없습니다.',
    autopilotLine: 'Brandstash가 자동으로 대신해 드립니다.',
    ctaLead: (n) => `Google 업데이트 기획·게시, 모든 리뷰 답변, 프로필을 항상 완전한 상태로 유지 — 매일, 전부 자동입니다. ${n}은 본업에만 집중하세요. 이 메일에 답장 주시면 2분 안에 무엇부터 고쳐질지 보여드립니다. 무료이고, 아무 조건 없습니다.`,
    ctaButton: '방법 보기',
    ctaMailSubject: (n) => `${n}의 지역 노출을 개선하고 싶습니다`,
    retentionLine: 'Google에서의 존재감이 아주 좋습니다. 이제 관건은 꾸준함입니다 — 리뷰·사진·업데이트를 계속 살아 있게 유지해 경쟁자가 앞서지 못하게 하세요.',
    sentBy: '보낸 사람',
    unsubscribe: '더 이상 받고 싶지 않으신가요? 수신 거부',
    reasonLine: '이 메일은 귀사의 비즈니스가 Google에 공개 등록되어 있어 1회에 한해 발송되었습니다.',
  },
  categories: {
    fotos: '사진', avaliacoes: '리뷰', horarios: '영업시간', descricao: '설명',
    website: '웹사이트', telefone: '전화', categorias: '카테고리', status: '영업 상태',
  },
  opportunities: {
    fotos: {
      ausente: '프로필에 사진이 없습니다 — 사진이 있는 프로필은 조회수와 방문이 크게 늘어납니다.',
      precisa_melhorar: '사진이 부족합니다. 외관·내부·팀의 최신 사진은 즉시 신뢰를 만듭니다.',
    },
    avaliacoes: {
      ausente: '아직 Google 리뷰가 없습니다 — 리뷰는 지역 고객에게 가장 중요한 신뢰 신호입니다.',
      precisa_melhorar: '리뷰 수와 평점을 더 키울 수 있습니다 — 꾸준한 4★+ 리뷰 흐름이 지역에서의 선택을 좌우합니다.',
    },
    horarios: {
      ausente: '영업시간이 등록되어 있지 않습니다 — 고객은 ‘영업 중’으로 필터링하며, 시간이 없는 프로필은 건너뜁니다.',
      precisa_melhorar: '영업시간이 불완전해 보입니다 — 요일별·공휴일 예외까지 최신으로 유지하세요.',
    },
    descricao: {
      ausente: '비즈니스 설명이 없습니다 — 명확한 소개는 Google과 고객에게 무엇을 제공하는지 정확히 알려줍니다.',
      precisa_melhorar: '설명이 짧습니다 — 내용을 보강하면 관련 검색에서의 순위가 개선됩니다.',
    },
    website: {
      ausente: '프로필에 웹사이트가 연결되어 있지 않습니다 — 이 링크는 가장 강력한 전환 수단 중 하나입니다.',
      precisa_melhorar: '웹사이트 링크가 정확하고 정상 작동하는지 확인하세요.',
    },
    telefone: {
      ausente: '전화번호가 없습니다 — 원터치 통화는 지역 고객이 연락하는 방식입니다.',
      precisa_melhorar: '등록된 전화번호를 다시 확인하세요.',
    },
    categorias: {
      ausente: '비즈니스 카테고리가 없습니다 — 카테고리 없이는 Google이 검색과 연결해 줄 수 없습니다.',
      precisa_melhorar: '카테고리가 하나뿐입니다 — 보조 카테고리를 추가하면 더 많은 검색에 노출됩니다.',
    },
    status: {
      ausente: '프로필이 폐업으로 표시되어 있습니다 — 지금 이 순간에도 고객을 돌려보내고 있습니다.',
      precisa_melhorar: '프로필 상태가 ‘영업 중’이 아닙니다 — 검색 손실을 막기 위해 상태를 확인하세요.',
    },
  },
}

export const EMAIL_LOCALES: Record<EmailLanguage, EmailLocale> = {
  en,
  pt,
  es,
  fr,
  de,
  it,
  'zh-TW': zhTW,
  'zh-HK': zhHK,
  ja,
  ko,
}
