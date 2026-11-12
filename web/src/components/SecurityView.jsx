import { useState } from 'react';
import ConfigChecks from './ConfigChecks.jsx';
import Vulnerabilities from './Vulnerabilities.jsx';

export default function SecurityView({ demo, initialFilter = '' }) {
  const [tab, setTab] = useState('config');
  const [filter, setFilter] = useState(initialFilter);

  return (
    <div className="security">
      <div className="seg sub-tabs">
        <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}>Config checks</button>
        <button className={tab === 'vulns' ? 'active' : ''} onClick={() => setTab('vulns')}>Vulnerabilities</button>
      </div>
      {tab === 'config' ? <ConfigChecks filter={filter} onFilter={setFilter} /> : <Vulnerabilities demo={demo} />}
    </div>
  );
}
