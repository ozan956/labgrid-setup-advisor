interface IconProps {
  name: 'arrow' | 'check' | 'copy' | 'power' | 'terminal';
}

export function Icon({ name }: IconProps) {
  const paths = {
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    power: <><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.8 0" /></>,
    terminal: <><path d="m5 7 4 4-4 4" /><path d="M12 17h7" /></>,
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

