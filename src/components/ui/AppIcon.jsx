const iconPaths = {
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  workspace: ['M4 5h16v14H4z', 'M4 10h16', 'M10 5v14'],
  overview: ['M4 12 10 6 14 10 20 4', 'M4 12v8h16V4'],
  dailyLog: ['M5 4h14v16H5z', 'M8 8h8', 'M8 12h8', 'M8 16h5'],
  battery: ['M7 5h9v14H7z', 'M10 2v3', 'M13 2v3', 'M9 10h5', 'M10 14h3'],
  faults: ['M12 3l8 14H4l8-14z', 'M12 9v4', 'M12 16h.01'],
  maintenance: ['M4 17l6-6 3 3 7-7', 'M14 4l2 2'],
  handover: ['M4 12h9', 'M10 8l4 4-4 4', 'M20 12H11'],
  history: ['M12 5v7l4 2', 'M4 12a8 8 0 1 0 2.34-5.66', 'M4 4v4h4'],
  reports: ['M5 4h14v16H5z', 'M8 8h8', 'M8 12h8', 'M8 16h4'],
  pack: ['M4 7l8-4 8 4-8 4-8-4z', 'M4 7v10l8 4 8-4V7', 'M12 11v10'],
  substation: ['M6 20V8l6-4 6 4v12', 'M9 12h6', 'M9 16h6'],
  employees: ['M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M4 20a4 4 0 0 1 8 0', 'M16 9a2 2 0 1 0 0-4', 'M16 20a4 4 0 0 0-2-3.47'],
  masters: ['M12 3v4', 'M12 17v4', 'M4.93 4.93l2.83 2.83', 'M16.24 16.24l2.83 2.83', 'M3 12h4', 'M17 12h4', 'M4.93 19.07l2.83-2.83', 'M16.24 7.76l2.83-2.83', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
  users: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M5 20a7 7 0 0 1 14 0'],
  audit: ['M6 5h12v14H6z', 'M9 9h6', 'M9 13h6', 'M9 17h4'],
  notice: ['M5 6h14v12H5z', 'M8 10h8', 'M8 14h5', 'M7 3h10'],
  feedback: ['M4 5h16v11H8l-4 3V5z', 'M8 10h8', 'M8 13h6'],
  session: ['M12 3a9 9 0 1 0 9 9', 'M12 8v5l3 3'],
  architecture: ['M4 18h16', 'M7 18V8h10v10', 'M10 8V4h4v4'],
  search: ['m18 18-3.5-3.5', 'M10 17a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z'],
  bell: ['M15 17H5l1.5-2V10a5.5 5.5 0 1 1 11 0v5L19 17z', 'M9 20a3 3 0 0 0 6 0'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronRight: ['m9 6 6 6-6 6'],
  expand: ['M8 4H4v4', 'M4 4l6 6', 'M16 4h4v4', 'M20 4l-6 6', 'M4 20l6-6', 'M4 20h4v-4', 'M20 20l-6-6', 'M16 20h4v-4'],
  compress: ['M10 10 4 4', 'M4 8V4h4', 'M14 10l6-6', 'M16 4h4v4', 'M10 14l-6 6', 'M4 16v4h4', 'M14 14l6 6', 'M16 20h4v-4'],
  profile: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M5 20a7 7 0 0 1 14 0'],
  signOut: ['M14 16l4-4-4-4', 'M8 12h10', 'M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4'],
  moon: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'],
  sun: [
    'M12 1v2',
    'M12 21v2',
    'M4.22 4.22l1.42 1.42',
    'M18.36 18.36l1.42 1.42',
    'M1 12h2',
    'M21 12h2',
    'M4.22 19.78l1.42-1.42',
    'M18.36 5.64l1.42-1.42',
    'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  ],
}

export default function AppIcon({
  name,
  size = 18,
  strokeWidth = 1.8,
  className = '',
}) {
  const paths = iconPaths[name] || iconPaths.workspace

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  )
}
