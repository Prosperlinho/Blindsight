import type { Metadata } from "next";
import InfoPage, { InfoSection } from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "Privacy Policy | BlindSight",
  description: "What data BlindSight handles, where it goes and how long it is kept.",
};

const LAST_UPDATED = "November 17, 2026";

const SECTIONS = [
  { id: "summary", title: "Summary" },
  { id: "wallet", title: "Wallet and payments" },
  { id: "questions", title: "Questions and answers" },
  { id: "datasets", title: "Published datasets" },
  { id: "browser", title: "Data in your browser" },
  { id: "logs", title: "Server logs" },
  { id: "third-parties", title: "Third parties" },
  { id: "retention", title: "Retention" },
  { id: "choices", title: "Your choices" },
  { id: "changes", title: "Changes and contact" },
];

export default function PrivacyPage() {
  return (
    <InfoPage
      eyebrow={`Last updated ${LAST_UPDATED}`}
      title="Privacy Policy"
      sections={SECTIONS}
      intro={
        <p>
          BlindSight is a hackathon project running on NEAR testnet. This policy describes what data the app
          handles, where it goes and how long it is kept. It reflects how the code works today, including its
          limits.
        </p>
      }
    >
      <InfoSection id="summary" title="Summary">
        <ul>
          <li>There are no BlindSight accounts, no cookies, no analytics and no advertising trackers.</li>
          <li>You are identified only by your NEAR account ID, which is public on the blockchain.</li>
          <li>
            Questions are only ever sent encrypted to a verified AI enclave, and the question text isn&apos;t kept
            after your request finishes.
          </li>
          <li>
            Answers are aggregate-only: BlindSight refuses questions that ask for raw records and withholds answers
            that reproduce them.
          </li>
          <li>
            Published datasets are encrypted at rest and deleted when you unpublish. In enclave mode they are
            encrypted in your browser and can only be opened inside BlindSight&apos;s attested enclave; otherwise
            BlindSight&apos;s server can decrypt them to answer questions.
          </li>
          <li>We don&apos;t sell or share your data for marketing.</li>
        </ul>
      </InfoSection>

      <InfoSection id="wallet" title="Wallet and payments">
        <p>
          When you connect a wallet, the app learns your NEAR account ID. It never sees or stores your private
          keys; signing happens in your wallet. Your browser reads your balance from a public NEAR RPC node.
        </p>
        <p>
          Every payment is a transfer on the NEAR blockchain. Transactions, including the sender, receiver,
          amount and time, are <strong>public and permanent</strong>. Neither BlindSight nor anyone else can
          remove them.
        </p>
        <p>
          To verify a payment, the server looks up the transaction on a public RPC node. It keeps the transaction
          hash for up to 24 hours to stop the same payment being used twice, together with a keyed hash of the
          question it paid for. These are held in server memory or in BlindSight&apos;s Redis database (Upstash),
          so every server instance sees them. Publishing-fee transaction hashes are stored with the vault listing
          for as long as the vault exists.
        </p>
      </InfoSection>

      <InfoSection id="questions" title="Questions and answers">
        <p>When you ask a question, BlindSight:</p>
        <ol>
          <li>
            Refuses it if it plainly asks for raw records or an individual&apos;s details. Your payment stays valid
            for a different question.
          </li>
          <li>
            Combines it with the vault&apos;s dataset into a prompt and sends it to NEAR AI Cloud, where the model
            runs inside an attested hardware enclave. In enclave mode this happens inside BlindSight&apos;s own
            attested enclave, not on its web server.
          </li>
          <li>
            Encrypts that prompt with Oblivious HTTP to a key held by the verified enclave, so NEAR AI&apos;s
            infrastructure outside the enclave can&apos;t read it. If the enclave can&apos;t be verified or the
            encrypted channel fails, <strong>the prompt is not sent at all</strong>. You get an error, and your
            payment stays valid for a retry.
          </li>
          <li>
            To detect attempts to reconstruct a dataset through many narrow questions, it keeps a short record
            for up to 10 minutes. The record holds keyed hashes of the question and of its words, and whether
            it looked like an extraction attempt. It is grouped by your account ID and the vault, and separately
            by a hash of your IP address and the vault. It never contains the question text. It is held in server
            memory or in BlindSight&apos;s Redis database (Upstash), and the hashing key never leaves BlindSight&apos;s
            servers.
          </li>
          <li>
            Checks the answer before releasing it. Answers that repeat most of a record, list many records, quote
            long passages, come back as a table, or contain a personal identifier from the dataset are withheld,
            and your payment stays valid for a different question.
          </li>
        </ol>
        <p>
          Questions and answers are not written to a database or to logs, and the question text isn&apos;t kept
          after your request finishes. The answer is returned to your browser and not kept on the server.
        </p>
        <p>
          The publisher of a vault does not see your questions. They can see the payments to their account on
          chain.
        </p>
      </InfoSection>

      <InfoSection id="datasets" title="Published datasets">
        <p>When you publish a vault:</p>
        <ul>
          <li>
            <strong>Public:</strong> the title, description, price, your account ID, the payout account, the
            publishing-fee transaction and the publish date. These are shown to every visitor.
          </li>
          <li>
            <strong>Encrypted:</strong> the dataset contents, including the names of the files you uploaded,
            stored in a private Supabase storage bucket.
          </li>
        </ul>
        <p>
          <strong>In enclave mode</strong>, your browser encrypts the dataset to a key that exists only inside
          BlindSight&apos;s enclave, a confidential virtual machine (Intel TDX) on Phala Cloud. BlindSight&apos;s web
          server checks the enclave&apos;s hardware attestation before every use, stores only the encrypted file and
          never sees its contents. The enclave decrypts the dataset in memory only to answer a question. The answer
          receipt says <strong>Vault data opened: only inside the BlindSight enclave</strong> when this applies,
          and the enclave&apos;s attestation is published at <code>/api/enclave</code>.
        </p>
        <p>
          <strong>Otherwise</strong>, the dataset is encrypted with AES-256-GCM using a key held by BlindSight&apos;s
          server, which decrypts it in memory to answer a question and may keep the prepared copy in memory for up
          to 30 minutes. That server is not an enclave, so you are trusting BlindSight with the contents.
        </p>
        <p>
          Either way, parts of the dataset are sent to the model as described above and answers are generated from
          it. The aggregate-only checks reduce, but can&apos;t rule out, information from the dataset appearing in
          answers.
        </p>
        <p>
          <strong>Don&apos;t publish real personal, medical, financial or otherwise confidential data.</strong>{" "}
          Use synthetic or non-sensitive data. By publishing, you confirm you have the right to share the data in
          this way.
        </p>
      </InfoSection>

      <InfoSection id="browser" title="Data in your browser">
        <p>The app stores a few things in your browser&apos;s local and session storage. They are not sent to BlindSight:</p>
        <ul>
          <li>Your wallet session, kept by the NEAR Wallet Selector so you stay connected.</li>
          <li>
            Your recent activity in the marketplace (up to 50 entries: type, amount, vault name and transaction
            hash), stored per account.
          </li>
          <li>A temporary flag that sends you to the marketplace after a wallet redirect.</li>
        </ul>
        <p>
          Disconnecting your wallet ends the session but keeps the activity history. Clearing this site&apos;s
          data in your browser removes all of it.
        </p>
      </InfoSection>

      <InfoSection id="logs" title="Server logs">
        <p>
          Our server logs record which step of a request ran and any error codes. They are written to exclude
          question text, dataset contents, file names and answers. Our hosting provider, Vercel, also keeps
          standard request logs such as IP address, user agent, URL and time, under its own policy.
        </p>
      </InfoSection>

      <InfoSection id="third-parties" title="Third parties">
        <p>BlindSight relies on these services. Each handles data under its own privacy policy:</p>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>What it receives</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Vercel</td>
              <td>Hosts the app; sees every request to it.</td>
            </tr>
            <tr>
              <td>NEAR AI Cloud</td>
              <td>The prompt (your question plus dataset contents), always encrypted to its enclave.</td>
            </tr>
            <tr>
              <td>Supabase</td>
              <td>Vault listings and encrypted dataset files.</td>
            </tr>
            <tr>
              <td>Phala Cloud (enclave mode)</td>
              <td>
                Runs BlindSight&apos;s enclave, which receives encrypted datasets and questions. Their contents are
                readable only inside the confidential VM.
              </td>
            </tr>
            <tr>
              <td>Upstash</td>
              <td>Used payment hashes and anti-probing hashes. No question text, datasets or answers.</td>
            </tr>
            <tr>
              <td>FastNear RPC</td>
              <td>Account and transaction lookups, from your browser and from our server.</td>
            </tr>
            <tr>
              <td>MyNearWallet, Meteor</td>
              <td>Whatever you approve in the wallet you choose.</td>
            </tr>
            <tr>
              <td>NEARBlocks</td>
              <td>Only if you open a transaction or account link.</td>
            </tr>
          </tbody>
        </table>
      </InfoSection>

      <InfoSection id="retention" title="Retention">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Kept for</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Question text</td>
              <td>Only while your request is being answered</td>
            </tr>
            <tr>
              <td>Anti-probing hashes (no question text)</td>
              <td>Up to 10 minutes</td>
            </tr>
            <tr>
              <td>Prepared dataset copy (in memory, direct mode only)</td>
              <td>Up to 30 minutes, or until the server instance restarts</td>
            </tr>
            <tr>
              <td>Used payment hashes</td>
              <td>Up to 24 hours</td>
            </tr>
            <tr>
              <td>Payment-to-question binding (keyed hash)</td>
              <td>Up to 3 hours</td>
            </tr>
            <tr>
              <td>Vault listing and encrypted dataset</td>
              <td>Until you unpublish the vault</td>
            </tr>
            <tr>
              <td>Blockchain transactions</td>
              <td>Permanently, on the public NEAR testnet</td>
            </tr>
            <tr>
              <td>Browser storage</td>
              <td>Wallet session until you disconnect; activity history until you clear site data</td>
            </tr>
          </tbody>
        </table>
      </InfoSection>

      <InfoSection id="choices" title="Your choices">
        <ul>
          <li>You can use the landing page and these docs without connecting a wallet.</li>
          <li>
            You can unpublish your vaults at any time. Unpublishing deletes the listing and the encrypted file.
          </li>
          <li>
            Because BlindSight has no accounts and stores no profile, there is nothing else tied to you to export
            or delete, beyond what is listed above. On-chain transactions can&apos;t be deleted by anyone.
          </li>
        </ul>
        <p>BlindSight is not directed at children under 13.</p>
      </InfoSection>

      <InfoSection id="changes" title="Changes and contact">
        <p>
          If how the app handles data changes, we&apos;ll update this page and its date. For questions or
          privacy requests, email <a href="mailto:prosperlinho@gmail.com">prosperlinho@gmail.com</a> or open an
          issue on{" "}
          <a href="https://github.com/Prosperlinho/Blindsight/issues" target="_blank" rel="noreferrer">GitHub</a>.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
