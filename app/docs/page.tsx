import type { Metadata } from "next";
import Link from "next/link";
import InfoPage, { InfoSection } from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "Docs | BlindSight",
  description: "How to buy answers from, and publish, confidential data vaults on BlindSight.",
};

const SECTIONS = [
  { id: "overview", title: "Overview" },
  { id: "getting-started", title: "Getting started" },
  { id: "asking", title: "Asking a question" },
  { id: "receipt", title: "The privacy receipt" },
  { id: "publishing", title: "Publishing a vault" },
  { id: "unpublishing", title: "Removing a vault" },
  { id: "fees", title: "Prices and fees" },
  { id: "agents", title: "API for agents" },
  { id: "limits", title: "Limits" },
  { id: "troubleshooting", title: "Troubleshooting" },
];

export default function DocsPage() {
  return (
    <InfoPage
      eyebrow="Documentation"
      title="Using BlindSight"
      sections={SECTIONS}
      intro={
        <p>
          BlindSight sells answers about a dataset, never the dataset itself. This guide covers buying an
          answer, reading the privacy receipt, publishing your own vault and calling the API from an agent.
          Everything runs on <strong className="text-white">NEAR testnet</strong>.
        </p>
      }
    >
      <InfoSection id="overview" title="Overview">
        <p>There are two roles:</p>
        <ul>
          <li>
            <strong>Publishers</strong> upload a dataset into a sealed vault and set a price per question. The
            dataset is encrypted at rest and is never shown to buyers.
          </li>
          <li>
            <strong>Buyers</strong> (people or AI agents) pay that price in NEAR to ask one question and get an
            AI-written answer.
          </li>
        </ul>
        <p>
          The model (DeepSeek V3.2) runs inside an attested Intel TDX enclave on NEAR AI Cloud. On every
          question BlindSight checks the enclave&apos;s attestation, encrypts the question to the enclave, and
          verifies the enclave&apos;s signature on the answer.
        </p>
      </InfoSection>

      <InfoSection id="getting-started" title="Getting started">
        <ol>
          <li>
            Get a NEAR testnet wallet, such as{" "}
            <a href="https://testnet.mynearwallet.com/" target="_blank" rel="noreferrer">MyNearWallet</a> or
            Meteor.
          </li>
          <li>
            Fund it from the <a href="https://near-faucet.io/" target="_blank" rel="noreferrer">NEAR testnet faucet</a>.
            Testnet NEAR has no monetary value.
          </li>
          <li>
            Click <strong>Open Marketplace</strong> on the <Link href="/">home page</Link> and connect your
            wallet. The marketplace opens once the wallet is connected.
          </li>
        </ol>
      </InfoSection>

      <InfoSection id="asking" title="Asking a question">
        <ol>
          <li>
            Find a vault in the <strong>Browse</strong> tab, or pick one directly in the <strong>Ask</strong> tab.
            Each vault shows its price per question.
          </li>
          <li>
            Type your question. Aggregate questions work best, for example{" "}
            <em>&ldquo;Which segment has the highest year-over-year growth?&rdquo;</em>
          </li>
          <li>
            Review the price breakdown (vault price plus the platform fee) and approve in your wallet. One
            approval signs both transfers.
          </li>
          <li>
            BlindSight confirms both transactions on chain, then runs the question in the enclave. The answer
            appears with a link to each transaction on NEARBlocks.
          </li>
        </ol>
        <p>
          The first question on a freshly started server takes about 25–35 seconds because verifying
          Intel&apos;s attestation takes around 20 of them. Attestations are then reused for 10 minutes and
          answers take about 8–12 seconds.
        </p>
        <p>
          If something fails after your payment is confirmed, you can retry with the same payment. You
          aren&apos;t charged twice.
        </p>
      </InfoSection>

      <InfoSection id="receipt" title="The privacy receipt">
        <p>
          Each answer carries a <strong>Verified private answer</strong> badge. Open <strong>Details</strong> to
          see what was checked for that specific answer:
        </p>
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>What it means</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Intel TDX</td>
              <td>
                The gateway and model quotes verified against Intel&apos;s certificate chain, bound to a fresh
                one-time nonce so they can&apos;t be replayed.
              </td>
            </tr>
            <tr>
              <td>Model &amp; GPU</td>
              <td>The model attestation and the NVIDIA GPU verdict.</td>
            </tr>
            <tr>
              <td>Encrypted to enclave</td>
              <td>
                The question was sent with Oblivious HTTP (RFC 9458) to a key signed by the attested gateway, so
                only the enclave could read it.
              </td>
            </tr>
            <tr>
              <td>Signed answer</td>
              <td>
                The enclave&apos;s ed25519 signature over the exact request and response bytes, checked against
                the attested key.
              </td>
            </tr>
            <tr>
              <td>Fingerprints</td>
              <td>SHA-256 hashes of the question and answer, and the enclave&apos;s signing key.</td>
            </tr>
          </tbody>
        </table>
        <p>
          The receipt only claims what actually passed. If a check couldn&apos;t finish in time, you still get
          the answer you paid for, the badge reads <strong>Private processing</strong> instead, and the details
          show which checks passed.
        </p>
      </InfoSection>

      <InfoSection id="publishing" title="Publishing a vault">
        <ol>
          <li>Open the <strong>Publish</strong> tab in the marketplace.</li>
          <li>
            Add a title (up to 80 characters), an optional description (up to 220) and one or more{" "}
            <code>.csv</code>, <code>.txt</code> or <code>.md</code> files. The combined dataset can be up to
            500 KB.
          </li>
          <li>Set a price per question and the account that should receive payments.</li>
          <li>
            Approve the one-time publishing fee. Once it confirms on chain, the dataset is encrypted with
            AES-256-GCM and stored in a private bucket. Only the title, description, price and account names
            are listed publicly.
          </li>
        </ol>
        <p>
          Buyers pay the vault price directly to your payout account. There is no escrow and no withdrawal
          step.
        </p>
        <p>
          <strong>Use synthetic or non-sensitive data.</strong> BlindSight&apos;s own server decrypts the
          dataset in memory to build the prompt, so you are trusting that server with it. See{" "}
          <a href="#limits">Limits</a>.
        </p>
      </InfoSection>

      <InfoSection id="unpublishing" title="Removing a vault">
        <p>
          Vaults you published show an <strong>Unpublish</strong> button when your wallet is connected. Removing one asks your
          wallet to sign a one-time message (NEP-413, no transaction or fee). The server checks that signature
          against a full-access key on your account, then deletes both the listing and the encrypted file.
        </p>
      </InfoSection>

      <InfoSection id="fees" title="Prices and fees">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Amount</th>
              <th>Paid to</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Question</td>
              <td>Set by the publisher</td>
              <td>The publisher&apos;s payout account (the treasury for sample vaults)</td>
            </tr>
            <tr>
              <td>Platform fee, per question</td>
              <td>0.01 NEAR</td>
              <td>BlindSight treasury</td>
            </tr>
            <tr>
              <td>Publishing fee, one time</td>
              <td>0.05 NEAR</td>
              <td>BlindSight treasury</td>
            </tr>
          </tbody>
        </table>
        <p>Sample vaults cost 0.1, 0.15 and 0.2 NEAR per question. Network gas is extra and very small.</p>
      </InfoSection>

      <InfoSection id="agents" title="API for agents">
        <p>Any program with a NEAR testnet key can buy answers without a browser:</p>
        <ol>
          <li>Transfer the vault price to the vault&apos;s payout account, and the fee to the platform treasury.</li>
          <li>
            <code>POST /api/query-tee</code> with both transaction hashes:
          </li>
        </ol>
        <pre>
          <code>{`{
  "query": "Which segment grew fastest?",
  "txHash": "<vault price transfer>",
  "feeTxHash": "<platform fee transfer>",
  "payerAccountId": "buyer.testnet",
  "vaultId": "q3-financial-market-demand"
}`}</code>
        </pre>
        <p>
          A successful response contains <code>insight</code> (the answer), <code>receiptId</code>,{" "}
          <code>payment</code> (the verified transfers) and <code>privacy</code> (the receipt fields:{" "}
          <code>attested</code>, <code>encryptedToEnclave</code>, <code>responseSigned</code>, TCB statuses, GPU
          verdict, nonce, signer key and hashes). Errors return{" "}
          <code>{`{ success: false, error, code }`}</code> with a 4xx or 5xx status.
        </p>
        <h3>Other endpoints</h3>
        <ul>
          <li>
            <code>GET /api/vaults</code> lists published vaults (metadata only).
          </li>
          <li>
            <code>POST /api/vaults</code> publishes a vault. It requires a verified publishing-fee transaction.
          </li>
          <li>
            <code>DELETE /api/vaults</code> unpublishes a vault. It requires a NEP-413 signature from the
            publisher.
          </li>
          <li>
            <code>POST /api/verify-payment</code> checks a transfer on its own, without running a question.
          </li>
        </ul>
        <p>
          The server verifies that each transfer is finalized and successful, was signed by the payer, went to
          the right receiver, covers the price, is under two hours old and hasn&apos;t been used before.
        </p>
      </InfoSection>

      <InfoSection id="limits" title="Limits">
        <ul>
          <li>
            <strong>BlindSight&apos;s server is not an enclave.</strong> The path from BlindSight to the model is
            attested, encrypted and signed, but the server decrypts published datasets in memory to build the
            prompt. Moving that step into a TEE is the next milestone.
          </li>
          <li>Testnet only, with no escrow contract. Transfers settle directly to recipients.</li>
          <li>
            Questions are limited to 2,000 characters, and about the first 32,000 characters of a dataset are
            given to the model.
          </li>
          <li>
            Anti-probing is a best-effort heuristic. Repeated, overlapping or extraction-style questions
            against one vault are rate-limited (20 per 10 minutes). This raises the cost of reconstructing a
            dataset but doesn&apos;t make it impossible.
          </li>
          <li>Replay protection and anti-probing are kept in memory per server instance.</li>
        </ul>
      </InfoSection>

      <InfoSection id="troubleshooting" title="Troubleshooting">
        <h3>The wallet window didn&apos;t open</h3>
        <p>Allow pop-ups for this site, then try again. MyNearWallet may redirect the whole page instead.</p>
        <h3>&ldquo;Potential probing attack detected&rdquo;</h3>
        <p>
          You hit the anti-probing limit for that vault. Wait about 10 minutes, and ask broader questions
          rather than many narrow variations of one.
        </p>
        <h3>The answer is taking a long time</h3>
        <p>
          The first question after the server starts includes about 20 seconds of enclave verification. Later
          questions are faster.
        </p>
        <h3>Payment went through but no answer</h3>
        <p>
          Ask again. Your confirmed payment is reused, so you won&apos;t be charged a second time. Both
          transactions are visible on NEARBlocks.
        </p>
        <p>
          Still stuck? Email <a href="mailto:prosperlinho@gmail.com">prosperlinho@gmail.com</a> or open an
          issue on{" "}
          <a href="https://github.com/Prosperlinho/Blindsight/issues" target="_blank" rel="noreferrer">GitHub</a>.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
