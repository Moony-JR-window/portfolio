import { SiteHeader } from '@/components/site-header'
import { HeroSection } from '@/components/hero-section'
import { AboutSection } from '@/components/about-section'
import { ResumeSection } from '@/components/resume-section'
import { ContactSection } from '@/components/contact-section'
import { SiteFooter } from '@/components/site-footer'
import { ScrollToTop } from '@/components/scroll-to-top'
import { VisitorCounter } from '@/components/visitor-counter'
import ChatPopup from '@/components/ui/message/ChatPopup'

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main>
        <HeroSection />
        <AboutSection />
        <ResumeSection />
        <ContactSection />
      </main>
      <SiteFooter />
      <ScrollToTop />
      <VisitorCounter />
      <ChatPopup/>
    </>
  )
}
