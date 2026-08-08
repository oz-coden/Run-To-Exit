using System.Collections;

namespace RunToExit.Core
{
    public interface ICommand
    {
        IEnumerator ExecuteCoroutine(CharacterBase character);
    }
}
