import { Cake, GraduationCap, MapPin, Briefcase } from 'lucide-react'
import { Reveal } from '@/components/reveal'
import { education, experience, profile } from '@/lib/portfolio-data'

function TimelineItem({
  title,
  period,
  place,
  role,
  details,
  comingSoon,
}: {
  title: string
  period?: string
  place?: string
  role?: string
  details: string[]
  comingSoon?: boolean
}) {
  return (
    <li className="relative border-l border-border pl-6">
      <span className="absolute -left-[7px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-primary bg-background" />
      <h4 className="font-heading text-lg font-bold text-foreground">{title}</h4>
      {period && (
        <p className="mt-0.5 inline-block rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
          {period}
        </p>
      )}
      {place && <p className="mt-1 text-sm italic text-muted-foreground">{place}</p>}
      {role && <p className="mt-1 text-sm font-medium text-primary">{role}</p>}
      {comingSoon ? (
        <div className="mt-3">
          <span className="dots-loading" aria-label="Coming soon">
            <span />
            <span />
            <span />
          </span>
        </div>
      ) : (
        details.length > 0 && (
          <ul className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
            {details.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </li>
  )
}

export function ResumeSection() {
  return (
    <section id="resume" className="bg-secondary/40 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mb-4">
          <h2 className="font-heading text-3xl font-extrabold sm:text-4xl">Resume</h2>
          <div className="mt-2 h-1 w-16 rounded-full bg-primary" />
        </Reveal>
        <Reveal className="mb-12">
          <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground">
            Welcome to my full-stack journey. Take a look at my background, education, and
            experience.
          </p>
        </Reveal>

        <div className="grid gap-10 lg:grid-cols-2">
          {/* Summary + Education */}
          <div className="space-y-8">
            <Reveal>
              <h3 className="mb-5 flex items-center gap-2 font-heading text-xl font-bold">
                <GraduationCap className="h-5 w-5 text-primary" />
                Summary &amp; Education
              </h3>
              <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <h4 className="font-heading text-lg font-bold">{profile.name}</h4>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Cake className="h-4 w-4 text-primary" /> Born {profile.birth}
                </p>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 text-primary" /> {profile.location}
                </p>
              </div>
            </Reveal>

            <Reveal>
              <ul className="space-y-8">
                {education.map((item, i) => (
                  <TimelineItem
                    key={i}
                    title={item.title}
                    period={item.period}
                    place={item.place}
                    details={[
                      ...item.details,
                      ...(item.link ? [] : []),
                    ]}
                  />
                ))}
              </ul>
              {education[0].link && (
                <p className="mt-4 border-l border-border pl-6 text-sm text-muted-foreground">
                  Featured:{' '}
                  <a
                    href={education[0].link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    {education[0].link.label} →
                  </a>
                </p>
              )}
            </Reveal>
          </div>

          {/* Experience */}
          <div>
            <Reveal>
              <h3 className="mb-5 flex items-center gap-2 font-heading text-xl font-bold">
                <Briefcase className="h-5 w-5 text-primary" />
                Professional Experience
              </h3>
              <ul className="space-y-8">
                {experience.map((item, i) => (
                  <TimelineItem
                    key={i}
                    title={item.title}
                    period={item.period}
                    role={item.role}
                    details={item.details}
                    comingSoon={item.comingSoon}
                  />
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}
