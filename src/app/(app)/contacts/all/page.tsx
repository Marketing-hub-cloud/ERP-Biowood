import { ContactsListPage } from "../contacts-list-page";

export const metadata = { title: "ผู้ติดต่อทั้งหมด" };

export default function Page() {
  return <ContactsListPage tab="all" />;
}
