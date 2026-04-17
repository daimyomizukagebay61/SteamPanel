interface Props {
  level: number;
}

export function SteamLevelBadge({ level }: Props) {
  if (level >= 100) {
    const hundred = Math.floor(level / 100) * 100;
    return (
      <div className={`steam-lvl l100p img-${hundred}`} title={`Level ${level}`}>
        <span>{level}</span>
      </div>
    );
  }

  const ten = Math.floor(level / 10) * 10;
  return (
    <div className={`steam-lvl l${ten}`} title={`Level ${level}`}>
      <span>{level}</span>
    </div>
  );
}
