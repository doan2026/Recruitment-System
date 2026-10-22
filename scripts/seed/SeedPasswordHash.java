import java.io.BufferedReader;
import java.io.InputStreamReader;
import org.springframework.security.crypto.bcrypt.BCrypt;

/** Hash a local fixture password from stdin; never include it in process arguments. */
class SeedPasswordHash {
  public static void main(String[] args) throws Exception {
    String password = new BufferedReader(new InputStreamReader(System.in)).readLine();
    System.out.print(BCrypt.hashpw(password, BCrypt.gensalt(10)));
  }
}
