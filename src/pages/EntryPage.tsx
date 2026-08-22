import ReceptionPage from "./ReceptionPage";

import "./EntryPage.css";

type EntryPageProps = {
  setPage: (
    page: string
  ) => void;

  openAdminAuth:
    () => void;
};

function EntryPage(
  props: EntryPageProps
) {
  return (
    <ReceptionPage
      {...props}
      mode="entry"
    />
  );
}

export default EntryPage;
