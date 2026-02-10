import { HomeLayout } from 'fumadocs-ui/layouts/home';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
      nav={{
        title: (
          <span className="font-bold text-lg">
            <span className="text-primary">Aiga</span>
          </span>
        ),
      }}
      links={[
        { text: 'Documentation', url: '/docs' },
        { text: 'GitHub', url: 'https://github.com/stevenzg/aiga', external: true },
      ]}
    >
      {children}
    </HomeLayout>
  );
}
