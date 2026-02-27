import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Charleston Finds',
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12 text-gray-800">
      <h1 className="text-2xl font-bold mb-6">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: February 2026</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="font-semibold text-base mb-2">What We Collect</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Location</strong> — Only when you grant permission, to show nearby spots. Never stored on our servers.</li>
            <li><strong>Submissions</strong> — When you add a spot, we store the title, description, name you provide, and pin location.</li>
            <li><strong>Analytics</strong> — We use privacy-focused analytics (Umami) to understand usage. No personal data is collected, no cookies are set, and all data is aggregated.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">What We Don&apos;t Collect</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>No account or login required</li>
            <li>No email addresses</li>
            <li>No tracking cookies</li>
            <li>No data sold to third parties</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">Third-Party Services</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Google Maps</strong> — Used to display the map. Subject to <a href="https://policies.google.com/privacy" className="text-teal-600 underline" target="_blank" rel="noopener noreferrer">Google&apos;s Privacy Policy</a>.</li>
            <li><strong>Cloudflare</strong> — DNS and CDN. Subject to <a href="https://www.cloudflare.com/privacypolicy/" className="text-teal-600 underline" target="_blank" rel="noopener noreferrer">Cloudflare&apos;s Privacy Policy</a>.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">Local Storage</h2>
          <p>We store your preferences (saved spots, welcome screen status, view mode) in your browser&apos;s local storage. This data stays on your device and is never sent to our servers.</p>
        </section>

        <section>
          <h2 className="font-semibold text-base mb-2">Contact</h2>
          <p>Questions? Use the Feedback button in the app or email <a href="mailto:hello@chsfinds.com" className="text-teal-600 underline">hello@chsfinds.com</a>.</p>
        </section>
      </div>

      <div className="mt-10 pt-6 border-t border-gray-200">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="text-teal-600 font-medium text-sm hover:underline">&larr; Back to Charleston Finds</a>
      </div>
    </div>
  );
}
