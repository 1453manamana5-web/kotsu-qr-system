import ReceptionPage from "./ReceptionPage";

import "./ExitPage.css";

type ExitPageProps = {
  setPage: (
    page: string
  ) => void;

  openAdminAuth:
    () => void;
};

function ExitPage(
  props: ExitPageProps
) {
  return (
    <ReceptionPage
      {...props}
      mode="exit"
    />
  );
}

export default ExitPage;
