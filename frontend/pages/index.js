import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { BOX_ABI, GOVERNOR_ABI, TOKEN_ABI } from "../lib/abis";

const STATUS = ["Pending", "Active", "Canceled", "Defeated", "Succeeded", "Queued", "Expired", "Executed"];

export default function HomePage() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [userAddress, setUserAddress] = useState("");
  const [proposals, setProposals] = useState([]);
  const [status, setStatus] = useState("");
  const [newProposal, setNewProposal] = useState({ title: "", value: "0", votingType: "0" });
  const [voteSpend, setVoteSpend] = useState({});

  const governorAddress = process.env.NEXT_PUBLIC_GOVERNOR_ADDRESS;
  const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS;
  const boxAddress = process.env.NEXT_PUBLIC_BOX_ADDRESS;

  const hasWallet = typeof window !== "undefined" && window.ethereum;

  const readProvider = useMemo(() => {
    if (provider) return provider;
    if (process.env.NEXT_PUBLIC_RPC_URL) {
      return new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
    }
    return null;
  }, [provider]);

  const governorRead = useMemo(() => {
    if (!readProvider || !governorAddress || governorAddress === ethers.ZeroAddress) return null;
    return new ethers.Contract(governorAddress, GOVERNOR_ABI, readProvider);
  }, [readProvider, governorAddress]);

  const governorWrite = useMemo(() => {
    if (!signer || !governorAddress || governorAddress === ethers.ZeroAddress) return null;
    return new ethers.Contract(governorAddress, GOVERNOR_ABI, signer);
  }, [signer, governorAddress]);

  const tokenWrite = useMemo(() => {
    if (!signer || !tokenAddress || tokenAddress === ethers.ZeroAddress) return null;
    return new ethers.Contract(tokenAddress, TOKEN_ABI, signer);
  }, [signer, tokenAddress]);

  const connectWallet = useCallback(async () => {
    if (!hasWallet) {
      setStatus("No wallet detected. Please install MetaMask.");
      return;
    }
    const nextProvider = new ethers.BrowserProvider(window.ethereum);
    await nextProvider.send("eth_requestAccounts", []);
    const nextSigner = await nextProvider.getSigner();
    setProvider(nextProvider);
    setSigner(nextSigner);
    setUserAddress(await nextSigner.getAddress());
    setStatus("Wallet connected");
  }, [hasWallet]);

  const fetchProposals = useCallback(async () => {
    if (!governorRead) return;
    try {
      const createdLogs = await governorRead.queryFilter(governorRead.filters.ProposalCreated(), 0, "latest");
      const items = await Promise.all(
        createdLogs.map(async (log) => {
          const proposalId = log.args.proposalId;
          const description = log.args.description || "Untitled";
          const title = description.split("\n")[0];
          const state = Number(await governorRead.state(proposalId));
          const voteTuple = await governorRead.proposalVotes(proposalId);
          const deadline = await governorRead.proposalDeadline(proposalId);
          const block = await readProvider.getBlock("latest");
          const remainingBlocks = Number(deadline) - Number(block.number);
          return {
            proposalId: proposalId.toString(),
            title,
            status: STATUS[state] || "Unknown",
            forVotes: voteTuple[1].toString(),
            againstVotes: voteTuple[0].toString(),
            abstainVotes: voteTuple[2].toString(),
            remainingBlocks,
          };
        })
      );
      setProposals(items.reverse());
    } catch (error) {
      setStatus(`Failed to fetch proposals: ${error.shortMessage || error.message}`);
    }
  }, [governorRead, readProvider]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  async function ensureDelegated() {
    if (!tokenWrite || !userAddress) return;
    const currentDelegate = await tokenWrite.delegates(userAddress);
    if (currentDelegate.toLowerCase() !== userAddress.toLowerCase()) {
      const tx = await tokenWrite.delegate(userAddress);
      await tx.wait();
    }
  }

  async function createProposal(event) {
    event.preventDefault();
    if (!governorWrite || !boxAddress || boxAddress === ethers.ZeroAddress) {
      setStatus("Missing contract addresses or wallet signer.");
      return;
    }
    try {
      setStatus("Creating proposal...");
      await ensureDelegated();
      const box = new ethers.Interface(BOX_ABI);
      const calldata = box.encodeFunctionData("store", [Number(newProposal.value || 0)]);
      const description = `${newProposal.title || "Untitled Proposal"}`;
      const tx = await governorWrite.proposeWithType(
        [boxAddress],
        [0],
        [calldata],
        description,
        Number(newProposal.votingType)
      );
      await tx.wait();
      setStatus("Proposal created");
      await fetchProposals();
    } catch (error) {
      setStatus(`Proposal failed: ${error.shortMessage || error.message}`);
    }
  }

  async function castVote(proposalId, support) {
    if (!governorWrite) {
      setStatus("Connect wallet to vote.");
      return;
    }
    try {
      setStatus("Submitting vote...");
      await ensureDelegated();
      const spend = voteSpend[proposalId];
      const tx = spend
        ? await governorWrite.castVoteWithReasonAndParams(
            proposalId,
            support,
            "vote",
            ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [Number(spend)])
          )
        : await governorWrite.castVote(proposalId, support);
      await tx.wait();
      setStatus("Vote submitted");
      await fetchProposals();
    } catch (error) {
      setStatus(`Vote failed: ${error.shortMessage || error.message}`);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">On-Chain Governance Dashboard</h1>
          <button
            data-testid="connect-wallet-button"
            onClick={connectWallet}
            className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500"
          >
            {userAddress ? "Connected" : "Connect Wallet"}
          </button>
        </header>

        <div data-testid="user-address" className="text-sm text-slate-300 break-all">
          {userAddress || "Not connected"}
        </div>

        <section className="rounded-lg border border-slate-700 p-4 bg-slate-900">
          <h2 className="font-semibold mb-3">Create Proposal</h2>
          <form className="grid grid-cols-1 md:grid-cols-4 gap-3" onSubmit={createProposal}>
            <input
              value={newProposal.title}
              onChange={(event) => setNewProposal((prev) => ({ ...prev, title: event.target.value }))}
              className="bg-slate-800 rounded px-3 py-2"
              placeholder="Proposal title"
            />
            <input
              type="number"
              min="0"
              value={newProposal.value}
              onChange={(event) => setNewProposal((prev) => ({ ...prev, value: event.target.value }))}
              className="bg-slate-800 rounded px-3 py-2"
              placeholder="Box value"
            />
            <select
              value={newProposal.votingType}
              onChange={(event) => setNewProposal((prev) => ({ ...prev, votingType: event.target.value }))}
              className="bg-slate-800 rounded px-3 py-2"
            >
              <option value="0">Standard (1T1V)</option>
              <option value="1">Quadratic</option>
            </select>
            <button className="bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-2">Submit</button>
          </form>
        </section>

        <section className="rounded-lg border border-slate-700 p-4 bg-slate-900">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Proposals</h2>
            <button onClick={fetchProposals} className="px-3 py-1 text-sm rounded bg-slate-700 hover:bg-slate-600">Refresh</button>
          </div>
          <div className="space-y-3">
            {proposals.map((proposal) => {
              const chartData = [
                { name: "For", value: Number(proposal.forVotes) },
                { name: "Against", value: Number(proposal.againstVotes) },
                { name: "Abstain", value: Number(proposal.abstainVotes) },
              ];
              return (
                <article data-testid="proposal-list-item" key={proposal.proposalId} className="rounded border border-slate-700 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-medium">{proposal.title}</h3>
                      <p className="text-sm text-slate-300">Status: {proposal.status}</p>
                      {proposal.status === "Active" && (
                        <p className="text-sm text-slate-400">Remaining blocks: {proposal.remainingBlocks}</p>
                      )}
                    </div>
                    <div className="w-56 h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={chartData} dataKey="value" outerRadius={45}>
                            <Cell fill="#22c55e" />
                            <Cell fill="#ef4444" />
                            <Cell fill="#eab308" />
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {proposal.status === "Active" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        placeholder="Optional token spend"
                        className="bg-slate-800 rounded px-3 py-2 text-sm"
                        value={voteSpend[proposal.proposalId] || ""}
                        onChange={(event) => setVoteSpend((prev) => ({ ...prev, [proposal.proposalId]: event.target.value }))}
                      />
                      <button
                        data-testid="vote-for-button"
                        onClick={() => castVote(proposal.proposalId, 1)}
                        className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500"
                      >
                        Vote For
                      </button>
                      <button
                        data-testid="vote-against-button"
                        onClick={() => castVote(proposal.proposalId, 0)}
                        className="px-3 py-2 rounded bg-rose-600 hover:bg-rose-500"
                      >
                        Vote Against
                      </button>
                      <button
                        data-testid="vote-abstain-button"
                        onClick={() => castVote(proposal.proposalId, 2)}
                        className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-500"
                      >
                        Vote Abstain
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
            {proposals.length === 0 && <p className="text-slate-300">No proposals found.</p>}
          </div>
        </section>

        <p className="text-sm text-slate-300">{status}</p>
      </div>
    </main>
  );
}
