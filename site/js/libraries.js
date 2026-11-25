// One entry per library. Adding a page = add a folder under site/<slug>/ and an entry here.
export const LIBRARIES = [
  { slug: 'lrucache', name: 'LRUCache', category: 'C++ Library', status: 'live',
    blurb: 'Fixed-capacity LRU cache with O(1) get, put and erase and zero steady-state heap allocations.' },
  { slug: 'hashmappro', name: 'HashMapPro', category: 'C++ Library', status: 'soon',
    blurb: 'Separate-chaining hash map with automatic rehashing.' },
  { slug: 'vectorpro', name: 'VectorPro', category: 'C++ Library', status: 'soon',
    blurb: 'std::vector-like array with a configurable growth policy.' },
  { slug: 'jsonparser', name: 'JsonParser', category: 'C++ Library', status: 'soon',
    blurb: 'RFC 8259 parser with a nesting-depth guard.' },
  { slug: 'dnsresolver', name: 'DnsResolver', category: 'C++ Library', status: 'soon',
    blurb: 'RFC 1035 packets, with compression-loop protection.' },
  { slug: 'raftcore', name: 'RaftCore', category: 'C++ Library', status: 'soon',
    blurb: 'Raft leader election and log replication on a simulated network.' },
  { slug: 'arenaallocator', name: 'ArenaAllocator', category: 'C++ Library', status: 'soon',
    blurb: 'Bump-pointer arena with nested rollback frames.' },
];
