export const profile = {
  name: 'Rorn Mony',
  alias: 'MooNyDev',
  email: 'rornmonyy009988@gmail.com',
  phone: '086938457',
  linkedinLabel: 'rorn_mony',
  linkedinUrl:
    'https://linkedin.com/in/rorn-mony-0908a72b7?utm_source=share_via&utm_content=profile&utm_medium=member_ios',
  birth: '10-04-2003',
  location: 'Krong Stueng Sen, Kampong Thom, Cambodia',
  roles: [
    'Back-End (mid level)',
    'Front-End (mid level)',
    'QA Engineer (mid level)',
    'DevOps Engineer (junior)',
  ],
  social: {
    facebook: 'https://www.facebook.com/profile.php?id=100034549472905&mibextid=ZbWKwL',
    instagram: '',
    telegram: 'https://t.me/+85578731099',
  },
}

export const aboutByYear = {
  2025: {
    role: 'full stack developer',
    text: [
      'I am a junior web and mobile app full-stack developer in my final year of Computer Science at the Royal University of Phnom Penh (RUPP).',
      'I have developed my skills through extensive internet research and hands-on projects, focusing on front-end, back-end, and automation testing technologies.',
    ],
  },
  2026: {
    role: 'QA Engineer',
    text: [
      'I am a QA Engineer with a strong foundation in full-stack web and mobile application development. I graduated in Computer Science from the Royal University of Phnom Penh.',
      'My background in front-end and back-end development helps me understand system architecture, code quality, and application workflows while focusing on automation testing and software quality.',
    ],
  },
} as const

export const frameworkSkills = [
  { name: 'NextJS', value: 100 },
  { name: 'ReactJS', value: 100 },
  { name: 'NestJS', value: 95 },
  { name: 'NodeJS', value: 90 },
  { name: 'ExpressJS', value: 90 },
  { name: 'Karate Framework', value: 90 },
  { name: 'Robot Framework', value: 80 },
  { name: 'Spring Boot', value: 75 },
]

export const toolSkills = [
  { name: 'Katalon Studio', value: 90 },
  { name: 'Appium', value: 90 },
  { name: 'JMeter', value: 90 },
  { name: 'K6 Tools', value: 80 },
  { name: 'Jenkins', value: 70 },
  { name: 'Report Portal', value: 60 },
]

export const education = [
  {
    title: 'Computer Science',
    period: '2024 - Present',
    place: 'Royal University of Phnom Penh (RUPP)',
    details: [
      "Year four at RUPP developing project: Dental Clinic Management System.",
      'Web application.',
    ],
    link: { label: 'SE Calculator', url: 'https://se-calcaulator.vercel.app/' },
  },
  {
    title: 'Computer Science',
    period: '2023 - 2024',
    place: 'Royal University of Phnom Penh (RUPP)',
    details: ['Developed a Delivery System.', 'Technology: C# + SQL Server.', 'Desktop application.'],
  },
  {
    title: 'Computer Science',
    period: '2022 - 2023',
    place: 'Royal University of Phnom Penh (RUPP)',
    details: ['Developed an e-commerce project.', 'Web application.'],
  },
  {
    title: 'Computer Science',
    period: '2021 - 2022',
    place: 'Royal University of Phnom Penh (RUPP)',
    details: [],
  },
]

export const experience = [
  {
    title: 'Coming Soon',
    period: '',
    role: '',
    comingSoon: true,
    details: [],
  },
  {
    title: 'Wing Bank',
    period: '2025 - present',
    role: 'QA Engineer',
    details: [
      'Executed automated mobile testing for Wing Bank, WingPay, POS applications, and other channels, ensuring stability, usability, and functionality after patch releases. Designed and validated API endpoints to verify data accuracy, reliability, and proper functionality across multiple platforms.',
      'Performed performance and load testing using Apache JMeter on remote servers via SSH, analyzing system scalability, response times, and stability under high traffic. Developed and maintained reusable automation scripts and test frameworks.',
      'Integrated automation test results with ReportPortal for real-time reporting, defect tracking, and analytics. Executed automated test scripts as part of CI/CD pipelines, validating application integrity before production deployments.',
    ],
  },
  {
    title: 'Public Open Source',
    period: '2025 - 2025',
    role: '2 months of Development at Env Manager',
    details: [
      'Designed and implemented environment-based configuration management supporting development, staging, and production environments.',
      'Utilized environment variables to improve security, flexibility, and maintainability of application settings, with modular configuration handling.',
      'Containerized the application using Docker to ensure consistent runtime behavior across environments.',
      'Built both front-end and back-end features, ensuring smooth integration between the client application and server APIs.',
    ],
  },
  {
    title: 'Wing Bank',
    period: '2024 - 2025',
    role: '3-month Apprenticeship — Back-End',
    details: [
      'Tested APIs of the WingPay-Merchant project. Role: Apprentice Automation Testing.',
      'WingPay-Merchant: a cutting-edge, secure, and instant cashless payment solution utilizing KHQR codes for shops, restaurants, and online payments from your smartphone.',
    ],
  },
  {
    title: 'SabaiCode School',
    period: '2024 - 2024',
    role: 'Camformant (6 months)',
    details: [
      'Created the Camformant project — a job search platform to help individuals navigate the job market and build professional CVs.',
      'Role: front-end and back-end.',
      'Technology: Next.js, Tailwind CSS, Express.js, TypeScript, MongoDB, and Socket.IO. Deployed with AWS (EC2) and CI/CD via GitHub.',
    ],
  },
]
