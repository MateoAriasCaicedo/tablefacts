import "server-only";
import type { Locale } from "./site";

/**
 * Every UI string, in both languages. `en` is typed against the shape of `es`,
 * so a key missing from either one fails type-checking here instead of
 * rendering blank at runtime.
 *
 * Dish and drink names and descriptions are not here: they come from
 * Supabase, in a single language (see content/menu.ts). Replace all the
 * copy below with the restaurant’s own.
 */
const es = {
  meta: {
    title: "Cannario | Restaurante y bar",
    description:
      "Cocina de temporada, coctelería de autor y buenos momentos. Reemplaza este texto con la descripción de tu restaurante.",
  },
  brand: {
    /* What follows the name where the name stands alone: the QR pages and the
       share card. A few words, since it is set in tracked capitals. */
    tagline: "Restaurante y bar",
  },
  intro: {
    skip: "Saltar",
  },
  notFound: {
    title: "Esta página no existe",
    home: "Inicio",
  },
  nav: {
    skip: "Saltar al contenido",
    primary: "Navegación principal",
    language: "Idioma",
    menuOpen: "Abrir menú de navegación",
    menuClose: "Cerrar menú de navegación",
    newTab: "(se abre en una pestaña nueva)",
    reserve: "Reservar",
    menu: "Menú",
    about: "Nosotros",
    events: "Eventos",
    gallery: "Galería",
    contact: "Contacto",
  },
  hero: {
    eyebrow: "Restaurante y bar · Tu ciudad",
    /* One sentence, set as two lines: the statement, then its turn in
       italic. Split here so the line break is the sentence’s own. */
    title: {
      lead: "Cocina con calma",
      turn: "para compartir",
    },
    subtitle:
      "Un restaurante y bar con cocina de temporada y coctelería de autor, en tu ciudad.",
    secondary: "Ver el menú",
  },
  gallery: {
    meta: {
      title: "Galería",
      description:
        "Fotos de los platos, la barra, los espacios, los eventos y el equipo de Cannario.",
    },
    title: "Momentos Cannario",
    lead: "Platos, cocteles, eventos y las personas detrás de cada mesa.",
    viewAll: "Ver todas las fotos",
    categories: {
      dishes: "Platos y bebidas",
      spaces: "Espacios",
      events: "Eventos",
      kitchen: "Cocina",
      team: "Equipo",
    },
    descriptions: {
      dishes:
        "Los platos de la cocina y los cocteles de la barra.",
      spaces:
        "El salón, la barra y la casa vista desde afuera.",
      events: "Música y celebraciones en el salón.",
      kitchen: "El fuego, la parrilla y las manos que cocinan cada plato.",
      team: "Cocina, barra y servicio: las personas detrás de cada mesa.",
    },
    open: "Ampliar foto",
    close: "Cerrar",
    previous: "Foto anterior",
    next: "Foto siguiente",
    viewer: "Visor de fotos",
  },
  concept: {
    label: "Nuestra cocina",
    heading: "Tu concepto en una frase",
    body: "Describe aquí la propuesta del restaurante en dos o tres líneas: el origen de los ingredientes, la técnica y el cuidado que ponen en cada plato y en cada trago.",
    stats: [
      { label: "Cocina", value: "Tu estilo" },
      { label: "Técnica", value: "Parrilla y horno" },
      { label: "Noches", value: "Música y eventos" },
    ],
  },
  about: {
    label: "Nosotros",
    heading: "Comer bien es una forma de celebrar",
    lede: "Un lugar cálido y lleno de detalles. Cuenta aquí dónde estás y cómo se siente.",
    paragraphs: [
      "Cannario nace de una idea simple: comer bien es una forma de celebrar. Cuenta aquí la historia del restaurante, quién lo fundó y por qué.",
      "Segundo párrafo: la propuesta de la cocina, los productos que usan y lo que hace distinta a la barra.",
    ],
    kitchenHeading: "La cocina",
    kitchenBody: "Una línea sobre cómo se cocina.",
    cuisines: [
      {
        name: "Pilar uno",
        text: "Describe en una línea un plato o una técnica representativa.",
      },
      {
        name: "Pilar dos",
        text: "Describe en una línea un segundo plato o técnica representativa.",
      },
      {
        name: "Pilar tres",
        text: "Describe en una línea un tercer plato o técnica representativa.",
      },
    ],
    teamHeading: "Cocina, barra y servicio",
    teamBody:
      "Trabajamos juntos para que tu mesa se sienta como en casa.",
    team: ["Cocina", "Barra", "Servicio"],
  },
  moment: {
    caption: "Tu lema aquí",
    moodDay: "Cae la tarde",
    moodNight: "La noche se brinda",
    cocktail: {
      lead: "Y sí, también es un trago",
      text: "Describe aquí el coctel de la casa en una línea.",
    },
  },
  bar: {
    label: "Coctelería",
    heading: "Coctelería de autor",
    body: "Clásicos de la casa, gin tonics y mocktails preparados frente a ti.",
    cta: "Ver las bebidas",
  },
  signature: {
    label: "Especialidades",
    heading: "Platos que se recuerdan",
    body: "Tres platos y un coctel de la casa para empezar a conocer la carta.",
    cta: "Ver la carta completa",
    items: [
      {
        title: "Plato de la casa uno",
        text: "Una línea con los ingredientes principales.",
      },
      {
        title: "Plato de la casa dos",
        text: "Una línea con los ingredientes principales.",
      },
      { title: "Postre de la casa", text: "Un postre para cerrar la noche." },
      {
        title: "Coctel de la casa",
        text: "Describe aquí el coctel de la casa en una línea.",
      },
    ],
  },
  events: {
    label: "Eventos",
    heading: "Eventos y celebraciones",
    body: "Música, noches temáticas y una mesa lista para tu próxima celebración.",
    points: [
      {
        title: "Programación",
        text: "Cuenta aquí qué eventos hay y cada cuánto cambian.",
      },
      {
        title: "Celebraciones",
        text: "Cumpleaños, aniversarios y reuniones. Cuenta aquí qué espacios tienes disponibles.",
      },
    ],
    plan: "Escribir por WhatsApp",
    planText: "Hola, quiero información para un evento en Cannario.",
  },
  visit: {
    heading: "Visítanos",
    addressLabel: "Dirección",
    hoursLabel: "Horarios",
    reachLabel: "Escríbenos",
    hoursRows: [
      { label: "Lunes a jueves", value: "12:00 a 22:00" },
      { label: "Viernes y sábado", value: "12:00 a 00:00" },
      { label: "Domingo", value: "12:00 a 20:00" },
    ],
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    directions: "Abrir en Waze",
    mapsDirections: "Abrir en Google Maps",
    eventsText:
      "Creamos tu evento a la medida por WhatsApp.",
  },
  reserve: {
    label: "Reservas",
    title: "Tu mesa te espera",
    body: "Reserva en línea y ven a conocer Cannario. Si prefieres, escríbenos por WhatsApp y te ayudamos con tu mesa.",
    button: "Reservar mesa",
    whatsapp: "Escríbenos por WhatsApp",
  },
  menu: {
    meta: {
      title: "Menú",
      description:
        "Carta de Cannario: comida, brunch y coctelería de autor.",
    },
    title: "Menú",
    lead: "Consulta con tu mesero por alérgenos y opciones sin gluten.",
    navLabel: "Categorías y secciones de la carta",
    priceLabel: "Precio",
    recommended: "Recomendado",
    unavailable:
      "No pudimos cargar la carta en este momento. Escríbenos por WhatsApp y te la enviamos.",
    // `categories` is keyed by the database slug. `sections` is keyed by the
    // exact uppercase string in the database, and a section missing here falls
    // back to the raw string.
    categories: {
      cocina: "Comida",
      brunch: "Brunch",
      bar: "Bebidas",
    },
    sections: {
      ENTRADAS: "Entradas",
      FUERTES: "Fuertes",
      "CORTES DE CARNE": "Cortes de carne",
      VEGETARIANO: "Vegetariano",
      "MENU DE NIÑOS": "Menú de niños",
      POSTRES: "Postres",
      "CLÁSICOS DE LA CASA": "Clásicos de la casa",
      "COCTELES DE AUTOR": "Cocteles de autor",
      "GIN TONICS": "Gin tonics",
      MOCKTAIL: "Mocktails",
    },
  },
  // The QR menu under /qr: landing, category index, one page per category.
  // Category and section names come from `menu` above, so a new section in
  // Supabase needs its key in one place only. `categoryBlurbs` is keyed by the
  // database slug, like `menu.categories`.
  qr: {
    meta: {
      landing: {
        title: "Carta",
        description:
          "La carta de Cannario: comida, brunch y bebidas.",
      },
      index: {
        title: "Explora la carta",
        description:
          "Comida, brunch y bebidas: elige una categoría de la carta de Cannario.",
      },
    },
    skip: "Ir a la carta",
    languageLabel: "Idioma",
    heading: "La carta",
    lead: "Comida, brunch y coctelería de autor.",
    explore: "Explorar la carta",
    indexHeading: "Elige una categoría",
    indexLead: "Elige por dónde empezar.",
    back: "Volver",
    backToMenu: "Volver a la carta",
    railLabel: "Categorías de la carta",
    sectionsLabel: "Secciones de la categoría",
    count: { one: "producto", other: "productos" },
    categoryBlurbs: {
      cocina: "Entradas, fuertes, cortes de carne y postres.",
      brunch: "Entradas y fuertes de brunch.",
      bar: "Cocteles de autor, clásicos, gin tonics y mocktails.",
    },
    photoHint: "Toca un plato para ver el detalle.",
    priceLabel: "Precio",
    recommended: "Recomendado",
    viewPhoto: "Ver detalle de",
    close: "Cerrar",
    allergens:
      "Si tienes una alergia o buscas opciones sin gluten, avisa a tu mesero antes de pedir.",
    unavailable:
      "No pudimos cargar la carta en este momento. Pídele la carta a tu mesero o escríbenos por WhatsApp.",
  },
  footer: {
    explore: "Explorar",
    rights: "Todos los derechos reservados.",
    privacy: "Política de privacidad",
  },
  consent: {
    title: "Privacidad",
    body: "Este sitio no usa cookies ni servicios de seguimiento. Si algún día añadimos servicios opcionales, solo se activarán si lo aceptas. Puedes cambiar tu elección cuando quieras.",
    privacy: "Política de privacidad",
    accept: "Aceptar",
    reject: "Rechazar",
    settings: "Preferencias de cookies",
  },
  privacy: {
    meta: {
      title: "Política de privacidad",
      description:
        "Qué datos trata Cannario cuando visitas este sitio, qué guarda en tu navegador y cómo ejercer tus derechos.",
    },
    title: "Política de privacidad",
    lead: "Qué datos trata este sitio, para qué y qué puedes hacer al respecto.",
    updated: "Última actualización",
    sections: [
      {
        heading: "Quién es el responsable",
        body: [
          "Cannario es el responsable del tratamiento de los datos descritos en esta política. Los datos de contacto están al final de la página.",
        ],
      },
      {
        heading: "Qué datos tratamos",
        body: [
          "Este sitio es informativo: no tiene cuentas, formularios ni compras, y no te pedimos datos personales para navegarlo.",
          "Como cualquier servidor web, nuestro proveedor de alojamiento registra datos técnicos de cada visita, como la dirección IP, el navegador, la página solicitada y la hora. Los usamos para mantener el sitio disponible y seguro, y no para identificarte.",
          "Si nos escribes por WhatsApp, recibimos tu número de teléfono, tu nombre de perfil y el contenido de tu mensaje. Los usamos solo para responderte o gestionar tu consulta o reserva.",
        ],
      },
      {
        heading: "Cookies y almacenamiento local",
        body: [
          "Este sitio no instala cookies.",
          "Lo único que guarda en tu navegador es tu elección sobre los servicios opcionales (aceptar o rechazar), en el almacenamiento local. No sale de tu dispositivo y no te identifica. Hoy el sitio no usa ningún servicio opcional, por lo que tu elección no cambia nada; si añadimos alguno, no se activará sin tu aceptación y esta política se actualizará.",
          "Puedes cambiar tu elección en cualquier momento con «Preferencias de cookies», al pie de la página.",
        ],
      },
      {
        heading: "Servicios de terceros",
        body: [
          "El sitio enlaza con servicios externos: la página de reservas, WhatsApp, Instagram, Waze y Google Maps. Solo se abren si pulsas el enlace, y desde ese momento aplican sus propias políticas de privacidad, que te recomendamos leer.",
          "El menú se carga desde nuestra base de datos y las fotos se sirven desde este mismo sitio; no se envía ningún dato tuyo a esos servicios.",
        ],
      },
      {
        heading: "Tus derechos",
        body: [
          "Puedes pedirnos acceso a tus datos, que los corrijamos o los eliminemos, oponerte a su tratamiento o retirar un consentimiento que hayas dado. También puedes presentar una reclamación ante la autoridad de protección de datos de tu país.",
          "Escríbenos por cualquiera de los medios de contacto de abajo y te responderemos en un plazo razonable.",
        ],
      },
      {
        heading: "Cambios en esta política",
        body: [
          "Si cambiamos esta política, publicaremos aquí la nueva versión y actualizaremos la fecha de arriba.",
        ],
      },
    ],
    contact: {
      heading: "Contacto",
      body: "Para cualquier consulta sobre tus datos:",
      whatsapp: "WhatsApp",
      phone: "Teléfono",
      email: "Correo electrónico",
    },
  },
};

export type Dictionary = typeof es;

const en: Dictionary = {
  meta: {
    title: "Cannario | Restaurant & bar",
    description:
      "Seasonal cooking, signature cocktails and good moments. Replace this text with your restaurant’s description.",
  },
  brand: {
    tagline: "Restaurant & bar",
  },
  intro: {
    skip: "Skip",
  },
  notFound: {
    title: "This page doesn’t exist.",
    home: "Home",
  },
  nav: {
    skip: "Skip to content",
    primary: "Main navigation",
    language: "Language",
    menuOpen: "Open navigation menu",
    menuClose: "Close navigation menu",
    newTab: "(opens in a new tab)",
    reserve: "Reserve",
    menu: "Menu",
    about: "About",
    events: "Events",
    gallery: "Gallery",
    contact: "Contact",
  },
  hero: {
    eyebrow: "Restaurant & bar · Your city",
    title: {
      lead: "Seasonal cooking",
      turn: "made to be shared",
    },
    subtitle:
      "A restaurant and bar with seasonal cooking and signature cocktails, in your city.",
    secondary: "See the menu",
  },
  gallery: {
    meta: {
      title: "Gallery",
      description:
        "Photos of the dishes, the bar, the spaces, the events and the team at Cannario.",
    },
    title: "Moments at Cannario",
    lead: "Dishes, cocktails, events and the people behind every table.",
    viewAll: "See all photos",
    categories: {
      dishes: "Food & drinks",
      spaces: "Spaces",
      events: "Events",
      kitchen: "Kitchen",
      team: "Team",
    },
    descriptions: {
      dishes:
        "Dishes from the kitchen and cocktails from the bar.",
      spaces:
        "The dining room, the bar and the house seen from outside.",
      events: "Music and celebrations in the dining room.",
      kitchen: "The fire, the grill and the hands that cook every dish.",
      team: "Kitchen, bar and service: the people behind every table.",
    },
    open: "Enlarge photo",
    close: "Close",
    previous: "Previous photo",
    next: "Next photo",
    viewer: "Photo viewer",
  },
  concept: {
    label: "Our kitchen",
    heading: "Your concept in one line",
    body: "Describe the restaurant’s approach here in two or three lines: where the ingredients come from, the technique, and the care that goes into every dish and every drink.",
    stats: [
      { label: "Kitchen", value: "Your style" },
      { label: "Technique", value: "Grill and oven" },
      { label: "Nights", value: "Music and events" },
    ],
  },
  about: {
    label: "About us",
    heading: "Eating well is a way of celebrating",
    lede: "A warm place full of details. Say here where you are and how it feels.",
    paragraphs: [
      "Cannario began with a simple idea: eating well is a way of celebrating. Tell the restaurant’s story here: who founded it and why.",
      "Second paragraph: the kitchen’s approach, the produce you use and what makes the bar different.",
    ],
    kitchenHeading: "The kitchen",
    kitchenBody: "One line on how the food is cooked.",
    cuisines: [
      {
        name: "Pillar one",
        text: "One line on a representative dish or technique.",
      },
      {
        name: "Pillar two",
        text: "One line on a second representative dish or technique.",
      },
      {
        name: "Pillar three",
        text: "One line on a third representative dish or technique.",
      },
    ],
    teamHeading: "Kitchen, bar and service",
    teamBody: "We work together so your table feels like home.",
    team: ["Kitchen", "Bar", "Service"],
  },
  moment: {
    caption: "Your motto here",
    moodDay: "Evening settles in",
    moodNight: "Here’s to the night",
    cocktail: {
      lead: "And yes, it is also a drink",
      text: "Describe the house cocktail here in one line.",
    },
  },
  bar: {
    label: "Cocktails",
    heading: "Signature cocktails",
    body: "House classics, gin and tonics and mocktails made in front of you.",
    cta: "See the drinks",
  },
  signature: {
    label: "Signatures",
    heading: "Dishes worth remembering",
    body: "Three house dishes and a cocktail to start getting to know the menu.",
    cta: "See the full menu",
    items: [
      {
        title: "House dish one",
        text: "One line with the main ingredients.",
      },
      {
        title: "House dish two",
        text: "One line with the main ingredients.",
      },
      {
        title: "House dessert",
        text: "A dessert to close the night.",
      },
      {
        title: "House cocktail",
        text: "Describe the house cocktail here in one line.",
      },
    ],
  },
  events: {
    label: "Events",
    heading: "Events and celebrations",
    body: "Music, themed nights and a table ready for your next celebration.",
    points: [
      {
        title: "Programme",
        text: "Say here which events you host and how often they change.",
      },
      {
        title: "Celebrations",
        text: "Birthdays, anniversaries and get-togethers. Say here which spaces are available.",
      },
    ],
    plan: "Message us on WhatsApp",
    planText: "Hi, I’d like information about an event at Cannario.",
  },
  visit: {
    heading: "Visit us",
    addressLabel: "Address",
    hoursLabel: "Hours",
    reachLabel: "Get in touch",
    hoursRows: [
      { label: "Monday to Thursday", value: "12:00 to 22:00" },
      { label: "Friday and Saturday", value: "12:00 to 00:00" },
      { label: "Sunday", value: "12:00 to 20:00" },
    ],
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    directions: "Open in Waze",
    mapsDirections: "Open in Google Maps",
    eventsText:
      "We create your event to order on WhatsApp.",
  },
  reserve: {
    label: "Reservations",
    title: "Your table is waiting",
    body: "Book online and come and see Cannario. Prefer to talk it through? Message us on WhatsApp and we will help with your table.",
    button: "Reserve a table",
    whatsapp: "Message us on WhatsApp",
  },
  menu: {
    meta: {
      title: "Menu",
      description:
        "Cannario menu: food, brunch and signature cocktails.",
    },
    title: "Menu",
    lead: "Ask your server about allergens and gluten-free options.",
    navLabel: "Menu categories and sections",
    priceLabel: "Price",
    recommended: "Recommended",
    unavailable:
      "We couldn’t load the menu right now. Message us on WhatsApp and we’ll send it to you.",
    categories: {
      cocina: "Food",
      brunch: "Brunch",
      bar: "Drinks",
    },
    sections: {
      ENTRADAS: "Starters",
      FUERTES: "Mains",
      "CORTES DE CARNE": "Cuts of meat",
      VEGETARIANO: "Vegetarian",
      "MENU DE NIÑOS": "Kids menu",
      POSTRES: "Desserts",
      "CLÁSICOS DE LA CASA": "House classics",
      "COCTELES DE AUTOR": "Signature cocktails",
      "GIN TONICS": "Gin and tonics",
      MOCKTAIL: "Mocktails",
    },
  },
  qr: {
    meta: {
      landing: {
        title: "Menu",
        description:
          "The Cannario menu: food, brunch and drinks.",
      },
      index: {
        title: "Explore the menu",
        description:
          "Food, brunch and drinks: choose a category from the Cannario menu.",
      },
    },
    skip: "Go to the menu",
    languageLabel: "Language",
    heading: "The menu",
    lead: "Food, brunch and signature cocktails.",
    explore: "Explore the menu",
    indexHeading: "Choose a category",
    indexLead: "Choose where to start.",
    back: "Back",
    backToMenu: "Back to the menu",
    railLabel: "Menu categories",
    sectionsLabel: "Sections of this category",
    count: { one: "item", other: "items" },
    categoryBlurbs: {
      cocina: "Starters, mains, cuts of meat and desserts.",
      brunch: "Brunch starters and mains.",
      bar: "Signature cocktails, classics, gin and tonics and mocktails.",
    },
    photoHint: "Tap a dish to see its details.",
    priceLabel: "Price",
    recommended: "Recommended",
    viewPhoto: "View details of",
    close: "Close",
    allergens:
      "If you have an allergy or need gluten-free options, tell your server before ordering.",
    unavailable:
      "We couldn’t load the menu right now. Ask your server for the menu or message us on WhatsApp.",
  },
  footer: {
    explore: "Explore",
    rights: "All rights reserved.",
    privacy: "Privacy policy",
  },
  consent: {
    title: "Privacy",
    body: "This site uses no cookies or tracking services. If we ever add optional services, they will only run if you accept. You can change your choice at any time.",
    privacy: "Privacy policy",
    accept: "Accept",
    reject: "Reject",
    settings: "Cookie settings",
  },
  privacy: {
    meta: {
      title: "Privacy policy",
      description:
        "What data Cannario handles when you visit this site, what it keeps in your browser and how to exercise your rights.",
    },
    title: "Privacy policy",
    lead: "What data this site handles, why, and what you can do about it.",
    updated: "Last updated",
    sections: [
      {
        heading: "Who is responsible",
        body: [
          "Cannario is the controller of the data described in this policy. Contact details are at the end of the page.",
        ],
      },
      {
        heading: "What data we handle",
        body: [
          "This site is informational: it has no accounts, forms or purchases, and we don’t ask for personal data to browse it.",
          "Like any web server, our hosting provider logs technical data about each visit, such as the IP address, browser, page requested and time. We use it to keep the site available and secure, not to identify you.",
          "If you message us on WhatsApp, we receive your phone number, profile name and the content of your message. We use them only to answer you or handle your enquiry or booking.",
        ],
      },
      {
        heading: "Cookies and local storage",
        body: [
          "This site does not set cookies.",
          "The only thing it keeps in your browser is your choice about optional services (accept or reject), in local storage. It never leaves your device and does not identify you. Today the site uses no optional service, so your choice changes nothing; if we add one, it will not run without your acceptance and this policy will be updated.",
          "You can change your choice at any time with “Cookie settings” at the foot of the page.",
        ],
      },
      {
        heading: "Third-party services",
        body: [
          "The site links to outside services: the booking page, WhatsApp, Instagram, Waze and Google Maps. They only open if you follow the link, and from then on their own privacy policies apply, which we suggest you read.",
          "The menu is loaded from our database and photos are served from this same site; none of your data is sent to those services.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "You can ask us for access to your data, to correct or delete it, to object to its processing, or to withdraw a consent you gave. You can also complain to the data protection authority in your country.",
          "Write to us through any of the contacts below and we will reply within a reasonable time.",
        ],
      },
      {
        heading: "Changes to this policy",
        body: [
          "If we change this policy, we will publish the new version here and update the date above.",
        ],
      },
    ],
    contact: {
      heading: "Contact",
      body: "For any question about your data:",
      whatsapp: "WhatsApp",
      phone: "Phone",
      email: "Email",
    },
  },
};

const dictionaries: Record<Locale, Dictionary> = { es, en };

export const getDictionary = (locale: Locale): Dictionary => dictionaries[locale];
