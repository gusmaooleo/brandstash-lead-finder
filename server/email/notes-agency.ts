/**
 * MARKETING-AGENCY outreach pack — same hand-typed note format as
 * notes.ts, a different pitch entirely.
 *
 * A business owner is sold "your Google profile is losing you customers".
 * An agency is sold the opposite side of that same problem: they already
 * sell presence, and keeping every client's Google profile alive (photos,
 * hours, posts, review replies, week after week) is the chore nobody on the
 * team wants. Brandstash is one dashboard where all of it stays updated —
 * scale and hours saved, not "fix your profile".
 *
 * Three initial angles, one per CTA the owner runs:
 *   1. free audit — "send me 3 clients, I'll audit their profiles on me"
 *   2. demo       — "2 minutes, I'll show you the dashboard"
 *   3. partner    — "agency terms, priced per client profile, yours to resell"
 * Plus the same two follow-ups (bump / breakup) the business pack uses.
 *
 * Findings and signoff are inherited from the business pack of the same
 * language: they describe the agency's OWN public profile, which is honest
 * material for a hook and keeps a single source of truth for that copy.
 */

import type { EmailLanguage } from '../../shared/types'
import { NOTE_PACKS, type NotePack, type Template } from './notes'

type AgencyTemplates = {
  /** [free audit, demo, partner terms] */
  variants: [Template, Template, Template]
  /** [bump (2nd send), breakup (3rd send)] */
  followups: [Template, Template]
}

const r1 = (n: number): string => n.toFixed(1)

/* ─────────────────────────── PT ─────────────────────────── */
const pt: AgencyTemplates = {
  variants: [
    {
      subject: () => `os perfis de 3 clientes seus, auditados por minha conta`,
      paragraphs: (c) => [
        `Oi! Aqui é ${c.sender}, da Brandstash — agência para agência, vou ser rápido.`,
        `A gente mantém perfil do Google Business vivo em escala: fotos, horários, novidades e respostas de avaliação de todos os clientes que uma agência atende, num painel só.`,
        `Antes de vender qualquer coisa: me manda 3 clientes seus que eu audito os perfis no Google e te devolvo o diagnóstico, de graça, seu para usar com ou sem a gente. (Fiz a mesma auditoria no perfil da própria ${c.name}: ${c.f1}.)`,
        `Responde com três nomes ou links. Se for útil, a gente conversa; se não for, os diagnósticos ficam com você do mesmo jeito.`,
      ],
      ps: () => `P.S.: só informação pública — sem senha, sem acesso à conta de ninguém.`,
    },
    {
      subject: ({ name }) => `quantos perfis do Google a ${name} mantém hoje?`,
      paragraphs: (c) => [
        `Oi, tudo bem? ${c.sender}, da Brandstash.`,
        `Quantos perfis de cliente a ${c.name} cuida hoje — 10, 30, 80? Seja qual for o número, é sempre a mesma tarefa que ninguém quer: foto nova, horário certo, novidade publicada, avaliação respondida. Vezes cada cliente. Toda semana.`,
        `Foi para isso que a Brandstash existe: um painel onde o perfil de cada cliente se mantém atualizado, com o trabalho repetitivo feito para o seu time em vez de pelo seu time.`,
        `Vale 2 minutos? Responde aqui que eu te mostro como fica com uma carteira como a de vocês.`,
      ],
      ps: () => `P.S.: não precisa instalar nada nem pedir acesso às contas dos clientes para ver funcionando.`,
    },
    {
      subject: ({ name }) => `condição de parceiro para a ${name}`,
      paragraphs: (c) => [
        `Oi! ${c.sender}, da Brandstash.`,
        `Vocês vendem presença; a gente mantém essa presença viva. Com a Brandstash, a ${c.name} passa a oferecer gestão do perfil do Google para todo cliente sem contratar ninguém para isso: um painel, o trabalho recorrente resolvido, e o relacionamento (e a margem) continuam de vocês.`,
        `Com agência a gente trabalha em condição de parceiro: preço por perfil de cliente, melhor quanto mais a ${c.name} traz, e vocês revendem pelo valor que quiserem.`,
        `Quer os números? Responde “parceiro” que eu mando — sem precisar de call.`,
      ],
      ps: (c) =>
        c.rating != null
          ? `P.S.: a ${c.name} está bem no Google (★${r1(c.rating)}${c.reviews ? `, ${c.reviews} avaliações` : ''}). Aqui não é sobre o perfil de vocês, é sobre os dos clientes.`
          : `P.S.: não é sobre o perfil da ${c.name}, é sobre os perfis que vocês administram.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `eu de novo, ${name} :)`,
      paragraphs: (c) => [
        `Oi! Sou eu de novo, ${c.sender} da Brandstash.`,
        `Te escrevi há alguns dias sobre manter os perfis dos clientes da ${c.name} atualizados a partir de um painel só. Caixa de entrada de agência é uma guerra, então vou direto:`,
        `a oferta continua de pé — 2 minutos e eu te mostro o painel, ou me manda 3 clientes que eu audito os perfis de graça. Nos dois casos, é só responder.`,
      ],
      ps: () => `P.S.: não é o momento? Responde “depois” que eu volto noutro trimestre, sem insistir.`,
    },
    {
      subject: ({ name }) => `última vez, prometo: ${name}`,
      paragraphs: (c) => [
        `Prometo que esta é minha última mensagem. Aqui é ${c.sender}, da Brandstash.`,
        `Escrevi duas vezes sobre cuidar da presença dos clientes de vocês num lugar só. Entendi o recado, sem ressentimento nenhum.`,
        `Antes de sair, algo que dá para usar hoje: no próprio perfil da ${c.name}, ${c.f1}. Vale rodar essa mesma checagem na carteira de vocês — é o ajuste que mexe mais rápido no ranking.`,
        `E se um dia esse trabalho recorrente do Google virar dor de cabeça de alguém aí, responde este email (ele não expira). Sucesso!`,
      ],
    },
  ],
}

/* ─────────────────────────── EN ─────────────────────────── */
const en: AgencyTemplates = {
  variants: [
    {
      subject: () => `3 of your clients' Google profiles, audited on me`,
      paragraphs: (c) => [
        `Hi! ${c.sender} here, from Brandstash — agency to agency, I'll be quick.`,
        `We keep Google Business profiles alive at scale: photos, hours, posts and review replies for every client an agency looks after, from one dashboard.`,
        `Before pitching you anything: send me 3 of your clients and I'll audit their Google profiles and send the findings back, free, yours to use with or without us. (I ran the same audit on ${c.name}'s own profile: ${c.f1}.)`,
        `Just reply with three names or links. If it's useful we talk; if not, you keep the audits anyway.`,
      ],
      ps: () => `P.S. Public information only — no passwords, no access to anyone's account.`,
    },
    {
      subject: ({ name }) => `how many Google profiles does ${name} keep alive?`,
      paragraphs: (c) => [
        `Hi, ${c.sender} from Brandstash.`,
        `How many client profiles does ${c.name} look after — 10, 30, 80? Whatever the number, it's the same chore nobody wants: fresh photos, right hours, a post, a review answered. Times every client. Every week.`,
        `That's the whole reason Brandstash exists: one dashboard where every client's profile stays updated, with the recurring work done for your team instead of by your team.`,
        `Worth 2 minutes? Reply and I'll walk you through it with a client list like yours on screen.`,
      ],
      ps: () => `P.S. Nothing to install, and you don't need account access from your clients to see it work.`,
    },
    {
      subject: ({ name }) => `partner terms for ${name}`,
      paragraphs: (c) => [
        `Hi! ${c.sender}, from Brandstash.`,
        `You sell presence; we keep it alive. With Brandstash, ${c.name} can offer Google profile management to every client without hiring for it: one dashboard, the recurring work handled, and the relationship (and the margin) stay yours.`,
        `With agencies we work on partner terms: priced per client profile, better the more ${c.name} brings in, and yours to resell at whatever you charge.`,
        `Want the numbers? Reply “partner” and I'll send them over — no call required.`,
      ],
      ps: (c) =>
        c.rating != null
          ? `P.S. ${c.name} looks good on Google (★${r1(c.rating)}${c.reviews ? `, ${c.reviews} reviews` : ''}). This isn't about your profile — it's about your clients'.`
          : `P.S. This isn't about ${c.name}'s own profile — it's about the ones you manage.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `me again, ${name} :)`,
      paragraphs: (c) => [
        `Hi! It's ${c.sender} from Brandstash again.`,
        `I wrote a few days ago about keeping ${c.name}'s client profiles updated from a single dashboard. Agency inboxes are a warzone, so, short version:`,
        `the offer stands — 2 minutes and I'll show you the dashboard, or send me 3 clients and I'll audit their profiles for free. Either way, just hit reply.`,
      ],
      ps: () => `P.S. Wrong time? Reply “later” and I'll come back another quarter, no chasing.`,
    },
    {
      subject: ({ name }) => `last one, promise: ${name}`,
      paragraphs: (c) => [
        `Promise this is my last email. ${c.sender}, from Brandstash.`,
        `I've written twice about running your clients' Google presence from one place, so I'll take the hint — no hard feelings at all.`,
        `Before I go, something you can use today: on ${c.name}'s own profile, ${c.f1}. Worth running that same check across the profiles you manage — it's the fix that moves ranking fastest.`,
        `And if that recurring Google work ever becomes someone's headache at ${c.name}, just reply to this email (it doesn't expire). Good luck out there!`,
      ],
    },
  ],
}

/* ─────────────────────────── ES ─────────────────────────── */
const es: AgencyTemplates = {
  variants: [
    {
      subject: () => `los perfiles de 3 de tus clientes, auditados por mi cuenta`,
      paragraphs: (c) => [
        `¡Hola! Soy ${c.sender}, de Brandstash — de agencia a agencia, seré breve.`,
        `Mantenemos vivos los perfiles de Google Business a escala: fotos, horarios, novedades y respuestas a reseñas de todos los clientes que gestiona una agencia, desde un solo panel.`,
        `Antes de venderte nada: mándame 3 clientes tuyos y audito sus perfiles de Google, gratis, y te devuelvo el diagnóstico para que lo uses con nosotros o sin nosotros. (Hice la misma auditoría con el perfil de ${c.name}: ${c.f1}.)`,
        `Respóndeme con tres nombres o enlaces. Si te sirve, hablamos; si no, los diagnósticos son tuyos igual.`,
      ],
      ps: () => `P.D.: solo información pública — sin contraseñas ni acceso a la cuenta de nadie.`,
    },
    {
      subject: ({ name }) => `¿cuántos perfiles de Google mantiene ${name} hoy?`,
      paragraphs: (c) => [
        `Hola, ${c.sender} de Brandstash.`,
        `¿Cuántos perfiles de clientes lleva ${c.name} hoy: 10, 30, 80? Sea cual sea el número, es siempre la misma tarea que nadie quiere: foto nueva, horario correcto, una publicación, una reseña respondida. Por cada cliente. Cada semana.`,
        `Para eso existe Brandstash: un panel donde el perfil de cada cliente se mantiene actualizado, con el trabajo repetitivo hecho para tu equipo en vez de por tu equipo.`,
        `¿Vale 2 minutos? Respóndeme y te lo muestro con una cartera como la tuya en pantalla.`,
      ],
      ps: () => `P.D.: no hay que instalar nada ni pedir acceso a las cuentas de tus clientes para verlo funcionar.`,
    },
    {
      subject: ({ name }) => `condiciones de partner para ${name}`,
      paragraphs: (c) => [
        `¡Hola! ${c.sender}, de Brandstash.`,
        `Ustedes venden presencia; nosotros la mantenemos viva. Con Brandstash, ${c.name} puede ofrecer gestión del perfil de Google a todos sus clientes sin contratar a nadie para eso: un panel, el trabajo recurrente resuelto, y la relación (y el margen) siguen siendo suyos.`,
        `Con agencias trabajamos con condiciones de partner: precio por perfil de cliente, mejor cuantos más traiga ${c.name}, y ustedes lo revenden al valor que quieran.`,
        `¿Quieres los números? Responde “partner” y te los mando — sin necesidad de llamada.`,
      ],
      ps: (c) =>
        c.rating != null
          ? `P.D.: ${c.name} está bien en Google (★${r1(c.rating)}${c.reviews ? `, ${c.reviews} reseñas` : ''}). Esto no va de tu perfil, va de los de tus clientes.`
          : `P.D.: esto no va del perfil de ${c.name}, va de los perfiles que ustedes administran.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `soy yo otra vez, ${name} :)`,
      paragraphs: (c) => [
        `¡Hola! Soy yo otra vez, ${c.sender} de Brandstash.`,
        `Te escribí hace unos días sobre mantener actualizados los perfiles de Google de los clientes de ${c.name} desde un solo panel. La bandeja de una agencia es una guerra, así que voy al grano:`,
        `la oferta sigue en pie — 2 minutos y te muestro el panel, o mándame 3 clientes y audito sus perfiles gratis. En ambos casos, basta responder.`,
      ],
      ps: () => `P.D.: ¿no es el momento? Responde “después” y vuelvo en otro trimestre, sin perseguirte.`,
    },
    {
      subject: ({ name }) => `última vez, lo prometo: ${name}`,
      paragraphs: (c) => [
        `Prometo que este es mi último correo. Soy ${c.sender}, de Brandstash.`,
        `Escribí dos veces sobre llevar la presencia de tus clientes desde un solo lugar. Entiendo el mensaje, sin problema alguno.`,
        `Antes de irme, algo que puedes usar hoy: en el propio perfil de ${c.name}, ${c.f1}. Vale la pena hacer esa misma revisión en los perfiles que gestionan — es el ajuste que más rápido mueve el ranking.`,
        `Y si algún día ese trabajo recurrente de Google se vuelve el dolor de cabeza de alguien en ${c.name}, responde a este correo (no caduca). ¡Mucho éxito!`,
      ],
    },
  ],
}

/* ─────────────────────────── FR ─────────────────────────── */
const fr: AgencyTemplates = {
  variants: [
    {
      subject: () => `3 fiches Google de vos clients, auditées à mes frais`,
      paragraphs: (c) => [
        `Bonjour ! Ici ${c.sender}, de Brandstash — d'agence à agence, je fais court.`,
        `Nous maintenons les fiches Google Business vivantes à grande échelle : photos, horaires, actualités et réponses aux avis, pour chaque client d'une agence, depuis un seul tableau de bord.`,
        `Avant de vous vendre quoi que ce soit : envoyez-moi 3 de vos clients, j'audite leurs fiches Google et je vous renvoie le diagnostic, gratuitement, à utiliser avec ou sans nous. (J'ai fait le même audit sur la fiche de ${c.name} : ${c.f1}.)`,
        `Répondez simplement avec trois noms ou liens. Si c'est utile, on en parle ; sinon, les diagnostics restent à vous.`,
      ],
      ps: () => `P.S. : uniquement des informations publiques — aucun mot de passe, aucun accès à un compte.`,
    },
    {
      subject: ({ name }) => `combien de fiches Google ${name} fait-elle vivre ?`,
      paragraphs: (c) => [
        `Bonjour, ${c.sender} de Brandstash.`,
        `Combien de fiches clients ${c.name} gère-t-elle aujourd'hui : 10, 30, 80 ? Quel que soit le nombre, c'est toujours la même corvée : une photo récente, les bons horaires, une actualité, un avis auquel répondre. Multiplié par chaque client. Chaque semaine.`,
        `C'est exactement pour ça que Brandstash existe : un tableau de bord où la fiche de chaque client reste à jour, le travail récurrent étant fait pour votre équipe plutôt que par votre équipe.`,
        `Ça vaut 2 minutes ? Répondez et je vous montre avec un portefeuille comme le vôtre à l'écran.`,
      ],
      ps: () => `P.S. : rien à installer, et aucun accès aux comptes de vos clients n'est nécessaire pour le voir fonctionner.`,
    },
    {
      subject: ({ name }) => `conditions partenaire pour ${name}`,
      paragraphs: (c) => [
        `Bonjour ! ${c.sender}, de Brandstash.`,
        `Vous vendez de la présence ; nous la maintenons vivante. Avec Brandstash, ${c.name} peut proposer la gestion de la fiche Google à tous ses clients sans recruter pour autant : un tableau de bord, le travail récurrent réglé, et la relation (comme la marge) reste chez vous.`,
        `Avec les agences, nous travaillons en conditions partenaire : tarif par fiche client, plus intéressant à mesure que ${c.name} en apporte, et vous revendez au prix que vous voulez.`,
        `Vous voulez les chiffres ? Répondez « partenaire » et je vous les envoie — sans rendez-vous téléphonique.`,
      ],
      ps: (c) =>
        c.rating != null
          ? `P.S. : ${c.name} s'en sort bien sur Google (★${r1(c.rating)}${c.reviews ? `, ${c.reviews} avis` : ''}). Il ne s'agit pas de votre fiche, mais de celles de vos clients.`
          : `P.S. : il ne s'agit pas de la fiche de ${c.name}, mais de celles que vous gérez.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `c'est encore moi, ${name} :)`,
      paragraphs: (c) => [
        `Bonjour ! C'est encore ${c.sender}, de Brandstash.`,
        `Je vous ai écrit il y a quelques jours au sujet des fiches Google des clients de ${c.name}, tenues à jour depuis un seul tableau de bord. Une boîte mail d'agence est un champ de bataille, alors je vais droit au but :`,
        `la proposition tient toujours — 2 minutes pour vous montrer l'outil, ou envoyez-moi 3 clients et j'audite leurs fiches gratuitement. Dans les deux cas, il suffit de répondre.`,
      ],
      ps: () => `P.S. : ce n'est pas le moment ? Répondez « plus tard » et je reviendrai un autre trimestre, sans relancer.`,
    },
    {
      subject: ({ name }) => `dernière fois, promis : ${name}`,
      paragraphs: (c) => [
        `Promis, c'est mon dernier e-mail. Ici ${c.sender}, de Brandstash.`,
        `J'ai écrit deux fois à propos de la présence Google de vos clients gérée au même endroit. Je comprends le message, sans rancune.`,
        `Avant de partir, quelque chose d'utile dès aujourd'hui : sur la fiche de ${c.name} elle-même, ${c.f1}. La même vérification vaut le coup sur les fiches que vous gérez — c'est le correctif qui fait bouger le classement le plus vite.`,
        `Et si un jour ce travail Google récurrent devient le casse-tête de quelqu'un chez ${c.name}, répondez à cet e-mail (il n'expire pas). Bonne continuation !`,
      ],
    },
  ],
}

/* ─────────────────────────── DE ─────────────────────────── */
const de: AgencyTemplates = {
  variants: [
    {
      subject: () => `3 Google-Profile Ihrer Kunden, auf meine Kosten geprüft`,
      paragraphs: (c) => [
        `Hallo! Hier ist ${c.sender} von Brandstash — Agentur zu Agentur, ich fasse mich kurz.`,
        `Wir halten Google-Unternehmensprofile im großen Stil lebendig: Fotos, Öffnungszeiten, Beiträge und Bewertungsantworten für jeden Kunden einer Agentur, aus einem Dashboard.`,
        `Bevor ich Ihnen irgendetwas verkaufe: Schicken Sie mir 3 Ihrer Kunden, ich prüfe deren Google-Profile und schicke Ihnen die Auswertung zurück — kostenlos, zur freien Verwendung, mit oder ohne uns. (Dieselbe Prüfung habe ich beim Profil von ${c.name} gemacht: ${c.f1}.)`,
        `Antworten Sie einfach mit drei Namen oder Links. Passt es, sprechen wir; passt es nicht, behalten Sie die Auswertungen trotzdem.`,
      ],
      ps: () => `P.S.: ausschließlich öffentliche Informationen — keine Passwörter, kein Zugriff auf irgendein Konto.`,
    },
    {
      subject: ({ name }) => `wie viele Google-Profile hält ${name} aktuell am Leben?`,
      paragraphs: (c) => [
        `Hallo, ${c.sender} von Brandstash.`,
        `Wie viele Kundenprofile betreut ${c.name} heute — 10, 30, 80? Egal wie viele: Es ist immer dieselbe ungeliebte Fleißarbeit. Neues Foto, korrekte Zeiten, ein Beitrag, eine beantwortete Bewertung. Mal jeder Kunde. Jede Woche.`,
        `Genau dafür gibt es Brandstash: ein Dashboard, in dem jedes Kundenprofil aktuell bleibt — die wiederkehrende Arbeit wird für Ihr Team erledigt statt von Ihrem Team.`,
        `2 Minuten wert? Antworten Sie kurz, dann zeige ich es Ihnen mit einem Kundenstamm wie Ihrem.`,
      ],
      ps: () => `P.S.: nichts zu installieren, und Sie brauchen keinen Kontozugriff Ihrer Kunden, um es zu sehen.`,
    },
    {
      subject: ({ name }) => `Partnerkonditionen für ${name}`,
      paragraphs: (c) => [
        `Hallo! ${c.sender} von Brandstash.`,
        `Sie verkaufen Sichtbarkeit; wir halten sie am Leben. Mit Brandstash kann ${c.name} die Pflege des Google-Profils jedem Kunden anbieten, ohne dafür jemanden einzustellen: ein Dashboard, die wiederkehrende Arbeit erledigt — Kundenbeziehung und Marge bleiben bei Ihnen.`,
        `Mit Agenturen arbeiten wir zu Partnerkonditionen: Preis pro Kundenprofil, besser je mehr ${c.name} einbringt, und Sie verkaufen zu Ihrem eigenen Preis weiter.`,
        `Wollen Sie die Zahlen? Antworten Sie mit „Partner“, dann schicke ich sie — ganz ohne Telefontermin.`,
      ],
      ps: (c) =>
        c.rating != null
          ? `P.S.: ${c.name} steht bei Google gut da (★${r1(c.rating)}${c.reviews ? `, ${c.reviews} Bewertungen` : ''}). Es geht hier nicht um Ihr Profil, sondern um die Ihrer Kunden.`
          : `P.S.: Es geht nicht um das Profil von ${c.name}, sondern um die, die Sie betreuen.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `ich schon wieder, ${name} :)`,
      paragraphs: (c) => [
        `Hallo! Ich bin es noch einmal, ${c.sender} von Brandstash.`,
        `Vor ein paar Tagen schrieb ich Ihnen, wie die Google-Profile der Kunden von ${c.name} aus einem einzigen Dashboard aktuell bleiben. Agentur-Postfächer sind ein Schlachtfeld, deshalb kurz:`,
        `das Angebot steht — 2 Minuten für eine Vorführung, oder schicken Sie mir 3 Kunden und ich prüfe deren Profile kostenlos. In beiden Fällen genügt eine Antwort.`,
      ],
      ps: () => `P.S.: Gerade kein guter Zeitpunkt? Antworten Sie „später“, dann melde ich mich in einem anderen Quartal — ohne Nachhaken.`,
    },
    {
      subject: ({ name }) => `letztes Mal, versprochen: ${name}`,
      paragraphs: (c) => [
        `Versprochen: Das ist meine letzte E-Mail. Hier ${c.sender} von Brandstash.`,
        `Ich habe zweimal geschrieben, wie sich die Google-Präsenz Ihrer Kunden an einem Ort führen lässt. Ich verstehe den Hinweis — völlig in Ordnung.`,
        `Vorher noch etwas, das Sie sofort nutzen können: Beim Profil von ${c.name} selbst gilt: ${c.f1}. Dieselbe Prüfung lohnt sich für die Profile, die Sie betreuen — es ist der Punkt, der das Ranking am schnellsten bewegt.`,
        `Und falls diese wiederkehrende Google-Arbeit bei ${c.name} irgendwann jemandem Kopfschmerzen bereitet: einfach auf diese E-Mail antworten (sie verfällt nicht). Viel Erfolg!`,
      ],
    },
  ],
}

/* ─────────────────────────── IT ─────────────────────────── */
const it: AgencyTemplates = {
  variants: [
    {
      subject: () => `3 profili Google dei vostri clienti, analizzati a mie spese`,
      paragraphs: (c) => [
        `Ciao! Sono ${c.sender}, di Brandstash — da agenzia ad agenzia, sarò breve.`,
        `Teniamo vivi i profili Google Business su larga scala: foto, orari, aggiornamenti e risposte alle recensioni per ogni cliente di un'agenzia, da un unico pannello.`,
        `Prima di venderti qualsiasi cosa: mandami 3 tuoi clienti, analizzo i loro profili Google e ti rimando il quadro completo, gratis, tuo da usare con o senza di noi. (La stessa analisi l'ho fatta sul profilo di ${c.name}: ${c.f1}.)`,
        `Rispondi con tre nomi o link. Se è utile ne parliamo; se non lo è, le analisi restano comunque tue.`,
      ],
      ps: () => `P.S.: solo informazioni pubbliche — nessuna password, nessun accesso agli account.`,
    },
    {
      subject: ({ name }) => `quanti profili Google tiene in vita ${name}?`,
      paragraphs: (c) => [
        `Ciao, ${c.sender} di Brandstash.`,
        `Quanti profili cliente segue oggi ${c.name}: 10, 30, 80? Qualunque sia il numero, è sempre lo stesso lavoro che nessuno vuole fare: foto nuove, orari giusti, un aggiornamento, una recensione a cui rispondere. Per ogni cliente. Ogni settimana.`,
        `È esattamente il motivo per cui esiste Brandstash: un pannello dove il profilo di ogni cliente resta aggiornato, con il lavoro ripetitivo fatto per il tuo team invece che dal tuo team.`,
        `Vale 2 minuti? Rispondi e te lo mostro con un portafoglio clienti come il tuo.`,
      ],
      ps: () => `P.S.: niente da installare e nessun accesso agli account dei clienti per vederlo funzionare.`,
    },
    {
      subject: ({ name }) => `condizioni partner per ${name}`,
      paragraphs: (c) => [
        `Ciao! ${c.sender}, di Brandstash.`,
        `Voi vendete presenza; noi la teniamo viva. Con Brandstash, ${c.name} può offrire la gestione del profilo Google a ogni cliente senza assumere nessuno: un pannello, il lavoro ricorrente risolto, e la relazione (e il margine) restano vostri.`,
        `Con le agenzie lavoriamo a condizioni partner: prezzo per profilo cliente, migliore quanti più ne porta ${c.name}, e voi rivendete al valore che volete.`,
        `Vuoi i numeri? Rispondi “partner” e te li mando — senza bisogno di una call.`,
      ],
      ps: (c) =>
        c.rating != null
          ? `P.S.: ${c.name} sta bene su Google (★${r1(c.rating)}${c.reviews ? `, ${c.reviews} recensioni` : ''}). Qui non si parla del vostro profilo, ma di quelli dei vostri clienti.`
          : `P.S.: non si parla del profilo di ${c.name}, ma di quelli che gestite voi.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `sono di nuovo io, ${name} :)`,
      paragraphs: (c) => [
        `Ciao! Sono di nuovo io, ${c.sender} di Brandstash.`,
        `Ti ho scritto qualche giorno fa su come tenere aggiornati i profili Google dei clienti di ${c.name} da un pannello solo. La casella di un'agenzia è una guerra, quindi vado dritto al punto:`,
        `la proposta resta valida — 2 minuti e ti mostro il pannello, oppure mandami 3 clienti e analizzo i loro profili gratis. In entrambi i casi basta rispondere.`,
      ],
      ps: () => `P.S.: non è il momento? Rispondi “più avanti” e torno in un altro trimestre, senza insistere.`,
    },
    {
      subject: ({ name }) => `ultima volta, promesso: ${name}`,
      paragraphs: (c) => [
        `Prometto che è la mia ultima email. Sono ${c.sender}, di Brandstash.`,
        `Ho scritto due volte sulla presenza Google dei vostri clienti gestita da un unico posto. Ho colto il messaggio, nessun problema.`,
        `Prima di sparire, una cosa utile da subito: sul profilo di ${c.name} stessa, ${c.f1}. Vale la pena fare lo stesso controllo sui profili che gestite — è l'intervento che muove più in fretta il posizionamento.`,
        `E se un giorno questo lavoro ricorrente su Google diventasse il mal di testa di qualcuno in ${c.name}, rispondi a questa email (non scade). In bocca al lupo!`,
      ],
    },
  ],
}

/* ─────────────────────────── zh-TW ─────────────────────────── */
const zhTW: AgencyTemplates = {
  variants: [
    {
      subject: () => `貴公司 3 位客戶的 Google 商家檔案，由我免費健檢`,
      paragraphs: (c) => [
        `您好！我是 Brandstash 的 ${c.sender}，同行之間，我長話短說。`,
        `我們讓 Google 商家檔案在規模化的情況下持續「活著」：相片、營業時間、最新動態、評論回覆，代理商手上的每一位客戶，都在同一個後台完成。`,
        `在推銷任何東西之前：請給我 3 位貴公司的客戶，我免費健檢他們的 Google 檔案，並把結果整理回傳給您，用不用我們都是您的。（同樣的健檢我也對 ${c.name} 的檔案做了：${c.f1}。）`,
        `直接回覆三個名稱或連結即可。有用的話我們再聊；沒用的話，報告照樣留給您。`,
      ],
      ps: () => `P.S.：只使用公開資訊 — 不需要密碼，也不需要任何帳號權限。`,
    },
    {
      subject: ({ name }) => `${name} 目前維護著多少個 Google 檔案？`,
      paragraphs: (c) => [
        `您好，我是 Brandstash 的 ${c.sender}。`,
        `${c.name} 現在照顧多少客戶檔案：10 個、30 個、還是 80 個？不論數字多少，永遠是同一件沒人想做的工作：換新相片、對時間、發動態、回評論。乘以每一位客戶，每一週。`,
        `Brandstash 就是為此而生：一個後台，每位客戶的檔案都自動保持更新，重複性的工作由我們替團隊完成，而不是由團隊自己扛。`,
        `值得 2 分鐘嗎？回覆這封信，我用類似貴公司的客戶名單示範給您看。`,
      ],
      ps: () => `P.S.：不必安裝任何東西，也不需要先取得客戶帳號權限才能看到效果。`,
    },
    {
      subject: ({ name }) => `給 ${name} 的合作夥伴方案`,
      paragraphs: (c) => [
        `您好！我是 Brandstash 的 ${c.sender}。`,
        `你們賣的是曝光，我們負責讓曝光持續有效。有了 Brandstash，${c.name} 不必為此增聘人手，就能把 Google 檔案維運加進每一位客戶的服務：一個後台、重複工作全包，客戶關係與利潤仍然是你們的。`,
        `對代理商我們採合作夥伴方案：以客戶檔案數計價，${c.name} 帶進來越多條件越好，並且可由你們自行定價轉售。`,
        `想看數字嗎？回覆「合作」我就寄給您 — 不需要開會。`,
      ],
      ps: (c) =>
        c.rating != null
          ? `P.S.：${c.name} 在 Google 上表現不錯（★${r1(c.rating)}${c.reviews ? `，${c.reviews} 則評論` : ''}）。這封信談的不是你們的檔案，而是客戶的。`
          : `P.S.：這封信談的不是 ${c.name} 自己的檔案，而是你們代管的那些。`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `又是我，${name} :)`,
      paragraphs: (c) => [
        `您好！又是我，Brandstash 的 ${c.sender}。`,
        `幾天前我寫信談過：從單一後台維持 ${c.name} 客戶 Google 檔案的更新。代理商的信箱像戰場，所以我直接說重點：`,
        `提議仍然有效 — 2 分鐘讓我示範後台，或給我 3 位客戶，我免費健檢他們的檔案。兩種都只要回覆這封信。`,
      ],
      ps: () => `P.S.：現在不方便？回覆「以後再說」，我下一季再來，不會一直追。`,
    },
    {
      subject: ({ name }) => `最後一封，我保證：${name}`,
      paragraphs: (c) => [
        `我保證這是最後一封信。我是 Brandstash 的 ${c.sender}。`,
        `關於「在同一個地方管理客戶的 Google 曝光」，我已經寫過兩次，我明白了，完全沒關係。`,
        `離開前，送您一個今天就能用的資訊：在 ${c.name} 自己的檔案上，${c.f1}。同樣的檢查也值得套用到你們代管的檔案 — 這是最快影響排名的修正。`,
        `哪天這件重複的 Google 工作變成 ${c.name} 誰的頭痛事，回覆這封信就好（它不會過期）。祝生意興隆！`,
      ],
    },
  ],
}

/* ─────────────────────────── zh-HK ─────────────────────────── */
const zhHK: AgencyTemplates = {
  variants: [
    {
      subject: () => `貴公司 3 個客戶的 Google 商家檔案，由我免費檢查`,
      paragraphs: (c) => [
        `您好！我係 Brandstash 嘅 ${c.sender}，同行之間，我講重點。`,
        `我哋幫手令 Google 商家檔案大規模保持「有人打理」：相片、營業時間、最新消息、評論回覆，代理公司手上每個客戶，全部喺同一個後台搞掂。`,
        `喺推銷任何嘢之前：畀我 3 個貴公司嘅客戶，我免費幫佢哋檢查 Google 檔案，再將結果整理返畀您，用唔用我哋都係您嘅。（同樣嘅檢查我都幫 ${c.name} 做咗：${c.f1}。）`,
        `回覆三個名或連結就得。有用嘅話我哋再傾；冇用嘅話，報告一樣留返畀您。`,
      ],
      ps: () => `P.S.：只用公開資料 — 唔需要密碼，亦唔需要任何帳戶權限。`,
    },
    {
      subject: ({ name }) => `${name} 而家打理緊幾多個 Google 檔案？`,
      paragraphs: (c) => [
        `您好，我係 Brandstash 嘅 ${c.sender}。`,
        `${c.name} 而家照顧緊幾多個客戶檔案：10 個、30 個定 80 個？無論幾多，都係同一件冇人想做嘅工夫：換新相、校時間、出帖、回評論。乘以每個客戶，每個星期。`,
        `Brandstash 就係為咗呢件事而生：一個後台，每個客戶嘅檔案自動保持更新，重複嘅工夫由我哋幫團隊做，而唔係團隊自己頂硬上。`,
        `值唔值 2 分鐘？回覆呢封信，我用相近規模嘅客戶名單示範畀您睇。`,
      ],
      ps: () => `P.S.：唔使裝任何嘢，亦唔使事先攞客戶帳戶權限先睇到效果。`,
    },
    {
      subject: ({ name }) => `畀 ${name} 嘅合作夥伴方案`,
      paragraphs: (c) => [
        `您好！我係 Brandstash 嘅 ${c.sender}。`,
        `你哋賣嘅係曝光，我哋負責令曝光持續有效。有咗 Brandstash，${c.name} 唔使請多個人，都可以將 Google 檔案維護加入每個客戶嘅服務：一個後台、重複工夫包晒，客戶關係同利潤仍然係你哋嘅。`,
        `對代理公司我哋用合作夥伴方案：按客戶檔案數計價，${c.name} 帶得越多條件越好，仲可以由你哋自己定價轉售。`,
        `想睇數字？回覆「合作」我就寄畀您 — 唔使開會。`,
      ],
      ps: (c) =>
        c.rating != null
          ? `P.S.：${c.name} 喺 Google 表現唔錯（★${r1(c.rating)}${c.reviews ? `，${c.reviews} 個評論` : ''}）。呢封信講嘅唔係你哋嘅檔案，而係客戶嘅。`
          : `P.S.：呢封信講嘅唔係 ${c.name} 自己嘅檔案，而係你哋代管嗰啲。`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `又係我，${name} :)`,
      paragraphs: (c) => [
        `您好！又係我，Brandstash 嘅 ${c.sender}。`,
        `幾日前我寫過：喺單一後台維持 ${c.name} 客戶 Google 檔案嘅更新。代理公司嘅信箱好似戰場，所以我直接講重點：`,
        `提議仍然有效 — 2 分鐘畀我示範後台，或者畀我 3 個客戶，我免費檢查佢哋嘅檔案。兩樣都係回覆呢封信就得。`,
      ],
      ps: () => `P.S.：而家唔方便？回覆「遲啲」，我下個季度再嚟，唔會煩住您。`,
    },
    {
      subject: ({ name }) => `最後一封，我保證：${name}`,
      paragraphs: (c) => [
        `我保證呢封係最後一封。我係 Brandstash 嘅 ${c.sender}。`,
        `關於「喺同一個地方管理客戶嘅 Google 曝光」，我已經寫過兩次，我明白晒，完全冇問題。`,
        `走之前送您一樣今日就用得着嘅嘢：喺 ${c.name} 自己嘅檔案上，${c.f1}。同樣嘅檢查亦值得用喺你哋代管嘅檔案 — 呢個係最快影響排名嘅修正。`,
        `如果有日呢啲重複嘅 Google 工夫變成 ${c.name} 邊個嘅頭痛事，回覆呢封信就得（佢唔會過期）。祝生意興隆！`,
      ],
    },
  ],
}

/* ─────────────────────────── JA ─────────────────────────── */
const ja: AgencyTemplates = {
  variants: [
    {
      subject: () => `貴社クライアント3社のGoogleプロフィール、無料で診断します`,
      paragraphs: (c) => [
        `はじめまして。Brandstashの${c.sender}と申します。同業者として、手短にご連絡します。`,
        `弊社は、Googleビジネスプロフィールを「数が多くても生きた状態」に保つ仕組みを提供しています。写真・営業時間・最新情報・クチコミ返信を、代理店が担当する全クライアント分、ひとつの管理画面で。`,
        `売り込みの前に、まずご提案です。貴社のクライアントを3社お知らせいただければ、そのGoogleプロフィールを無料で診断し、結果をお返しします。弊社をご利用にならなくても、そのままお使いいただけます。（同じ診断を${c.name}様のプロフィールにも行いました：${c.f1}。）`,
        `3社の名前かURLをご返信いただくだけで結構です。お役に立てば話を続け、そうでなければ診断結果だけお持ちください。`,
      ],
      ps: () => `追伸：公開情報のみを使用します。パスワードもアカウント権限も一切不要です。`,
    },
    {
      subject: ({ name }) => `${name}様は今、いくつのGoogleプロフィールを維持していますか？`,
      paragraphs: (c) => [
        `Brandstashの${c.sender}と申します。`,
        `${c.name}様が現在担当されているクライアントのプロフィールは、10件でしょうか、30件、あるいは80件でしょうか。件数が何であれ、作業は同じです。新しい写真、正しい営業時間、最新情報の投稿、クチコミへの返信。それをクライアントの数だけ、毎週。`,
        `Brandstashはまさにそのために生まれました。ひとつの管理画面で全クライアントのプロフィールが最新に保たれ、繰り返しの作業は貴社チーム「が」ではなく貴社チーム「のために」処理されます。`,
        `2分だけいただけますか。ご返信いただければ、貴社に近い規模のクライアント一覧でご覧いただけます。`,
      ],
      ps: () => `追伸：インストールは不要で、クライアントのアカウント権限がなくても動作をご確認いただけます。`,
    },
    {
      subject: ({ name }) => `${name}様向けのパートナー条件`,
      paragraphs: (c) => [
        `Brandstashの${c.sender}と申します。`,
        `貴社が売るのは「見つけてもらう力」、弊社はそれを生かし続ける役割です。Brandstashを使えば、${c.name}様は増員なしで全クライアントにGoogleプロフィール運用を提供できます。管理画面ひとつ、繰り返しの作業は完了済み、関係性も利益率も貴社のままです。`,
        `代理店様にはパートナー条件をご用意しています。クライアントのプロフィール単位の料金で、${c.name}様がお持ちいただくほど条件は良くなり、貴社の価格で再販いただけます。`,
        `条件をご覧になりますか。「パートナー」とご返信いただければお送りします。お電話は不要です。`,
      ],
      ps: (c) =>
        c.rating != null
          ? `追伸：${c.name}様のGoogle評価は良好です（★${r1(c.rating)}${c.reviews ? `／クチコミ${c.reviews}件` : ''}）。今回は貴社のプロフィールではなく、クライアント様のプロフィールについてのご提案です。`
          : `追伸：${c.name}様ご自身のプロフィールではなく、貴社が運用されているプロフィールについてのご提案です。`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `${name}様、再びのご連絡です`,
      paragraphs: (c) => [
        `再びのご連絡失礼します。Brandstashの${c.sender}です。`,
        `先日、${c.name}様のクライアント様のGoogleプロフィールを、ひとつの管理画面で最新に保つ件をお送りしました。代理店様の受信箱は激戦区と存じますので、要点のみ。`,
        `ご提案は有効です。2分で管理画面をお見せするか、クライアント3社をお知らせいただければ無料で診断します。いずれもご返信いただくだけで結構です。`,
      ],
      ps: () => `追伸：今は時期ではない場合、「また今度」とご返信ください。別の四半期に改めます。追いかけはいたしません。`,
    },
    {
      subject: ({ name }) => `${name}様、最後のご連絡です`,
      paragraphs: (c) => [
        `お約束します。これが最後のメールです。Brandstashの${c.sender}です。`,
        `クライアント様のGoogle運用を一元化するご提案を二度お送りしました。今はご縁がなかったということで、まったく問題ございません。`,
        `最後に、本日から使える情報をひとつ。${c.name}様ご自身のプロフィールでは、${c.f1}。同じ点検を、貴社が運用されているプロフィールにも行う価値があります。検索順位に最も早く効く改善です。`,
        `いつかこの繰り返し作業が${c.name}様の負担になった際は、このメールにご返信ください（期限はありません）。ご発展をお祈りしています。`,
      ],
    },
  ],
}

/* ─────────────────────────── KO ─────────────────────────── */
const ko: AgencyTemplates = {
  variants: [
    {
      subject: () => `고객사 3곳의 Google 프로필, 제가 무료로 진단해 드립니다`,
      paragraphs: (c) => [
        `안녕하세요! Brandstash의 ${c.sender}입니다. 같은 업계끼리, 짧게 말씀드리겠습니다.`,
        `저희는 Google 비즈니스 프로필을 규모 있게 “살아 있는 상태”로 유지합니다. 사진, 영업시간, 소식, 리뷰 답변까지 — 대행사가 관리하는 모든 고객사를 하나의 대시보드에서요.`,
        `무언가를 팔기 전에 먼저 제안드립니다. 고객사 3곳만 알려주시면 그 Google 프로필을 무료로 진단해 결과를 보내드리겠습니다. 저희와 함께하든 아니든 그대로 쓰시면 됩니다. (같은 진단을 ${c.name}의 프로필에도 해봤습니다: ${c.f1}.)`,
        `이름이나 링크 세 개만 회신해 주세요. 도움이 되면 이야기를 이어가고, 아니면 진단 결과만 가져가시면 됩니다.`,
      ],
      ps: () => `추신: 공개 정보만 사용합니다. 비밀번호도, 어떤 계정 권한도 필요하지 않습니다.`,
    },
    {
      subject: ({ name }) => `${name}은 지금 몇 개의 Google 프로필을 관리하고 있나요?`,
      paragraphs: (c) => [
        `안녕하세요, Brandstash의 ${c.sender}입니다.`,
        `${c.name}이 지금 맡고 있는 고객사 프로필은 10개인가요, 30개인가요, 80개인가요? 숫자가 얼마든 일은 똑같습니다. 새 사진, 정확한 영업시간, 소식 하나, 리뷰 답변 하나. 고객사 수만큼, 매주.`,
        `Brandstash는 정확히 그 때문에 만들어졌습니다. 하나의 대시보드에서 모든 고객사 프로필이 최신 상태로 유지되고, 반복 업무는 팀이 하는 대신 팀을 위해 처리됩니다.`,
        `2분만 내주시겠어요? 회신 주시면 비슷한 규모의 고객 목록으로 보여드리겠습니다.`,
      ],
      ps: () => `추신: 설치할 것도 없고, 고객사 계정 권한 없이도 어떻게 작동하는지 확인하실 수 있습니다.`,
    },
    {
      subject: ({ name }) => `${name}을 위한 파트너 조건`,
      paragraphs: (c) => [
        `안녕하세요! Brandstash의 ${c.sender}입니다.`,
        `여러분은 노출을 팔고, 저희는 그 노출이 계속 살아 있게 합니다. Brandstash를 쓰면 ${c.name}은 인력을 늘리지 않고도 모든 고객사에 Google 프로필 관리를 제공할 수 있습니다. 대시보드 하나, 반복 업무는 해결, 고객 관계와 마진은 그대로 여러분 것입니다.`,
        `대행사와는 파트너 조건으로 일합니다. 고객사 프로필 단위 가격이며, ${c.name}이 많이 가져올수록 조건이 좋아지고, 원하는 가격에 재판매하실 수 있습니다.`,
        `숫자를 보시겠어요? “파트너”라고 회신 주시면 보내드리겠습니다. 통화는 필요 없습니다.`,
      ],
      ps: (c) =>
        c.rating != null
          ? `추신: ${c.name}은 Google에서 좋은 편입니다(★${r1(c.rating)}${c.reviews ? `, 리뷰 ${c.reviews}개` : ''}). 이 메일은 여러분의 프로필이 아니라 고객사의 프로필에 관한 것입니다.`
          : `추신: 이 메일은 ${c.name} 자체 프로필이 아니라 여러분이 관리하는 프로필에 관한 것입니다.`,
    },
  ],
  followups: [
    {
      subject: ({ name }) => `또 저입니다, ${name} :)`,
      paragraphs: (c) => [
        `안녕하세요! 또 저입니다, Brandstash의 ${c.sender}.`,
        `며칠 전 ${c.name}이 관리하는 고객사 Google 프로필을 하나의 대시보드에서 최신으로 유지하는 이야기를 드렸습니다. 대행사 메일함은 전쟁터라는 걸 알기에 요점만 말씀드립니다.`,
        `제안은 그대로입니다 — 2분이면 대시보드를 보여드리고, 아니면 고객사 3곳을 주시면 프로필을 무료로 진단해 드립니다. 어느 쪽이든 회신만 주시면 됩니다.`,
      ],
      ps: () => `추신: 지금이 아니라면 “나중에”라고만 회신 주세요. 다음 분기에 다시 연락드리고, 쫓아다니지 않겠습니다.`,
    },
    {
      subject: ({ name }) => `마지막입니다, 약속드려요: ${name}`,
      paragraphs: (c) => [
        `약속대로 이번이 마지막 메일입니다. Brandstash의 ${c.sender}입니다.`,
        `고객사의 Google 노출을 한곳에서 관리하는 이야기를 두 번 드렸습니다. 지금은 때가 아니라는 뜻으로 알겠습니다. 정말 괜찮습니다.`,
        `떠나기 전에 오늘 바로 쓰실 수 있는 것 하나만 남기겠습니다. ${c.name} 자체 프로필의 경우, ${c.f1}. 관리 중인 프로필에도 같은 점검을 해보실 만합니다. 순위를 가장 빨리 움직이는 수정이거든요.`,
        `언젠가 이 반복 업무가 ${c.name}의 누군가에게 골칫거리가 된다면, 이 메일에 회신해 주세요(만료되지 않습니다). 좋은 성과 있으시길 바랍니다!`,
      ],
    },
  ],
}

const AGENCY_TEMPLATES: Record<EmailLanguage, AgencyTemplates> = {
  pt, en, es, fr, de, it, 'zh-TW': zhTW, 'zh-HK': zhHK, ja, ko,
}

/**
 * Full packs: agency copy over the business pack's findings + signoff (same
 * language, same facts about the agency's own public profile).
 */
export const AGENCY_NOTE_PACKS: Record<EmailLanguage, NotePack> = Object.fromEntries(
  (Object.keys(AGENCY_TEMPLATES) as EmailLanguage[]).map((language) => [
    language,
    { ...NOTE_PACKS[language], ...AGENCY_TEMPLATES[language] },
  ]),
) as Record<EmailLanguage, NotePack>
